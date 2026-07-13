/**
 * Stop-time review gate helpers (testable without Claude hooks).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getWorkingTreeState, resolveReviewTarget, collectReviewContext } from "./git.mjs";
import { runHeadlessTurn, REVIEW_DISALLOWED_TOOLS, parseStructuredOutput, readOutputSchema } from "./grok.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./prompts.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
export const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";

const SKIP_HINTS = [
  "/grok:setup",
  "/grok:status",
  "/grok:result",
  "/grok:cancel",
  "/grok:transfer",
  "# Grok Setup",
  "# Grok Status",
  "# Grok Cancel",
  "Grok review started in the background",
  STOP_REVIEW_TASK_MARKER
];

export function shouldSkipStopGateForAssistantMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return true;
  }
  if (text.includes(STOP_REVIEW_TASK_MARKER)) {
    return true;
  }
  // Short status-only replies without edit signals.
  const lower = text.toLowerCase();
  if (SKIP_HINTS.some((hint) => text.includes(hint))) {
    return true;
  }
  // Heuristic: pure tables / status listings.
  if (!/\b(edit|fixed|changed|wrote|updated|created|deleted|patch|commit)\b/i.test(text) && text.length < 400) {
    if (lower.includes("status:") || lower.includes("job ") || lower.includes("ready")) {
      return true;
    }
  }
  return false;
}

export function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      reason:
        "The stop-time Grok review task returned no final output. Run /grok:review --wait manually or bypass the gate."
    };
  }

  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) {
    return { ok: true, reason: null };
  }
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return {
      ok: false,
      reason: `Grok stop-time review found issues that still need fixes before ending the session: ${reason}`
    };
  }

  // Structured review JSON fallback.
  const parsed = parseStructuredOutput(text);
  if (parsed.parsed?.verdict === "approve") {
    return { ok: true, reason: null };
  }
  if (parsed.parsed?.verdict === "needs-attention") {
    const top = Array.isArray(parsed.parsed.findings) && parsed.parsed.findings[0];
    const detail = top?.title || parsed.parsed.summary || "needs attention";
    return {
      ok: false,
      reason: `Grok stop-time review found issues that still need fixes before ending the session: ${detail}`
    };
  }

  return {
    ok: false,
    reason:
      "The stop-time Grok review task returned an unexpected answer. Run /grok:review --wait manually or bypass the gate."
  };
}

export function isStopGateJob(job) {
  if (!job) {
    return false;
  }
  return (
    String(job.summary ?? "").includes("Stop-gate") ||
    String(job.title ?? "").includes("Stop Gate") ||
    String(job.kindLabel ?? "") === "stop-gate"
  );
}

/**
 * Run the stop-gate review. Prefer embedded dirty-tree structured review when possible.
 */
export async function runStopGateReview(cwd, input = {}, options = {}) {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  if (shouldSkipStopGateForAssistantMessage(lastAssistantMessage)) {
    return { ok: true, reason: null, skipped: true, detail: "non-edit turn" };
  }

  let workingTreeDirty = false;
  try {
    workingTreeDirty = getWorkingTreeState(cwd).isDirty;
  } catch {
    workingTreeDirty = false;
  }

  if (!workingTreeDirty) {
    // No local code changes — allow stop (matches "only block if turn made edits").
    return { ok: true, reason: null, skipped: true, detail: "clean working tree" };
  }

  const runTurn = options.runHeadlessTurnImpl ?? runHeadlessTurn;
  const target = resolveReviewTarget(cwd, { scope: "working-tree" });
  const context = collectReviewContext(cwd, target, { includeDiff: true });
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";
  const prompt = interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
    REVIEW_INPUT: context.content
  });

  let schema = null;
  try {
    schema = readOutputSchema(REVIEW_SCHEMA);
  } catch {
    schema = null;
  }

  const result = await runTurn({
    prompt,
    cwd: context.repoRoot ?? cwd,
    alwaysApprove: true,
    disallowedTools: REVIEW_DISALLOWED_TOOLS,
    jsonSchema: schema,
    noSubagents: true,
    disableWebSearch: true,
    timeoutMs: options.timeoutMs ?? 15 * 60 * 1000
  });

  // Prefer structured verdict when schema worked.
  if (schema) {
    const structured = parseStructuredOutput(result.text);
    if (structured.parsed?.verdict === "approve") {
      return { ok: true, reason: null, skipped: false, rawOutput: result.text };
    }
    if (structured.parsed?.verdict === "needs-attention") {
      const top = Array.isArray(structured.parsed.findings) && structured.parsed.findings[0];
      const detail = top?.title || structured.parsed.summary || "needs attention";
      return {
        ok: false,
        reason: `Grok stop-time review found issues that still need fixes before ending the session: ${detail}`,
        skipped: false,
        rawOutput: result.text
      };
    }
  }

  return { ...parseStopReviewOutput(result.text), skipped: false, rawOutput: result.text };
}
