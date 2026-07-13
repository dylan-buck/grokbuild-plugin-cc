#!/usr/bin/env node

/**
 * Fake Grok CLI for unit tests.
 * Modes via FAKE_GROK_MODE:
 * - auto | review-json | task-ok | task-fail | empty | allow | block | auth-fail | echo-args
 */

import fs from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const mode = process.env.FAKE_GROK_MODE || "auto";

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write("grok 0.0.0-fake\n");
  process.exit(0);
}

function getPrompt() {
  const pIndex = args.indexOf("-p");
  if (pIndex !== -1 && args[pIndex + 1]) {
    return args[pIndex + 1];
  }
  const fileIndex = args.indexOf("--prompt-file");
  if (fileIndex !== -1 && args[fileIndex + 1] && fs.existsSync(args[fileIndex + 1])) {
    return fs.readFileSync(args[fileIndex + 1], "utf8");
  }
  return "";
}

const prompt = getPrompt();
const resumeIndex = args.indexOf("--resume");
const resumeId = resumeIndex !== -1 ? args[resumeIndex + 1] : null;

function emit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

if (mode === "echo-args") {
  const dumpPath = process.env.FAKE_GROK_ARGS_FILE;
  const payload = { args, promptLength: prompt.length, hasAlwaysApprove: args.includes("--always-approve") };
  if (dumpPath) {
    fs.writeFileSync(dumpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  emit({
    text: JSON.stringify(payload),
    sessionId: "session-echo-args",
    stopReason: "EndTurn"
  });
}

if (mode === "auth-fail") {
  emit({ type: "error", message: "authentication failed" }, 1);
}

if (mode === "allow") {
  emit({ text: "ALLOW: no material issues", sessionId: "session-allow", stopReason: "EndTurn" });
}

if (mode === "block") {
  emit({ text: "BLOCK: critical null deref remains", sessionId: "session-block", stopReason: "EndTurn" });
}

const effectiveMode =
  mode === "auto"
    ? prompt.includes("adversarial") ||
      prompt.includes("code review") ||
      prompt.includes("structured_output_contract") ||
      prompt.includes("stop-gate") ||
      args.includes("--json-schema")
      ? "review-json"
      : "task-ok"
    : mode;

if (effectiveMode === "review-json") {
  // Stop-gate structured path: approve if prompt asks for clean allow via env
  if (process.env.FAKE_GROK_REVIEW_VERDICT === "approve") {
    emit({
      text: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine.",
        findings: [],
        next_steps: []
      }),
      sessionId: "session-review-approve",
      stopReason: "EndTurn"
    });
  }
  emit({
    text: JSON.stringify({
      verdict: "needs-attention",
      summary: "One material issue found in the change.",
      findings: [
        {
          severity: "high",
          title: "Missing null check",
          body: "Input may be null before use.",
          file: "src/example.js",
          line_start: 10,
          line_end: 12,
          confidence: 0.8,
          recommendation: "Guard against null before dereference."
        }
      ],
      next_steps: ["Add a null check and a unit test."]
    }),
    sessionId: "session-review-1",
    stopReason: "EndTurn"
  });
}

if (effectiveMode === "task-ok") {
  const text = resumeId
    ? `Resumed ${resumeId}. Applied the top fix.`
    : `Task completed for: ${prompt.slice(0, 80)}`;
  emit({
    text,
    sessionId: resumeId || "session-task-1",
    stopReason: "EndTurn"
  });
}

if (effectiveMode === "task-fail") {
  emit(
    {
      type: "error",
      message: "Simulated Grok failure"
    },
    1
  );
}

if (effectiveMode === "empty") {
  emit({ text: "", sessionId: "session-empty", stopReason: "EndTurn" });
}

emit({
  text: `Fake grok handled prompt (${effectiveMode}).`,
  sessionId: "session-default",
  stopReason: "EndTurn"
});
