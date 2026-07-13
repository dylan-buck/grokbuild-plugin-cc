#!/usr/bin/env node

/**
 * Fake Grok CLI for unit tests.
 * Modes via FAKE_GROK_MODE:
 * - version (default when --version)
 * - review-json
 * - task-ok
 * - task-fail
 * - empty
 */

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
  return "";
}

const prompt = getPrompt();
const resumeIndex = args.indexOf("--resume");
const resumeId = resumeIndex !== -1 ? args[resumeIndex + 1] : null;

function emit(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

const effectiveMode =
  mode === "auto"
    ? prompt.includes("adversarial") || prompt.includes("code review") || prompt.includes("structured_output_contract") || args.includes("--json-schema")
      ? "review-json"
      : "task-ok"
    : mode;

if (effectiveMode === "review-json") {
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
