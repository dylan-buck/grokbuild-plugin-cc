#!/usr/bin/env node

/**
 * Fake Grok CLI for unit tests.
 * Modes via FAKE_GROK_MODE:
 * - auto | review-json | structured-only | task-ok | task-fail | empty | allow | block | auth-fail | echo-args | imagine-ok
 */

import fs from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const mode = process.env.FAKE_GROK_MODE || "auto";
const wantsStreaming = args.includes("streaming-json");

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
    const content = fs.readFileSync(args[fileIndex + 1], "utf8");
    const filePath = args[fileIndex + 1];
    if (filePath.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        const blocks = Array.isArray(parsed) ? parsed : parsed?.content;
        if (Array.isArray(blocks)) {
          return blocks
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
            .join("\n");
        }
      } catch {
        // fall through
      }
    }
    return content;
  }
  return "";
}

const prompt = getPrompt();
const resumeIndex = args.indexOf("--resume");
const resumeId = resumeIndex !== -1 ? args[resumeIndex + 1] : null;

function emit(payload, code = 0) {
  if (wantsStreaming) {
    const text =
      typeof payload.text === "string"
        ? payload.text
        : payload.type === "error" && typeof payload.message === "string"
          ? payload.message
          : JSON.stringify(payload);
    if (payload.type === "error") {
      process.stdout.write(`${JSON.stringify({ type: "error", message: payload.message || text })}\n`);
      process.exit(code);
    }
    process.stdout.write(`${JSON.stringify({ type: "thought", data: "fake thinking" })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "text", data: text })}\n`);
    process.stdout.write(
      `${JSON.stringify({
        type: "end",
        sessionId: payload.sessionId ?? "session-stream",
        stopReason: payload.stopReason ?? "EndTurn",
        ...(payload.structuredOutput !== undefined ? { structuredOutput: payload.structuredOutput } : {})
      })}\n`
    );
    process.exit(code);
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

if (mode === "echo-args") {
  const dumpPath = process.env.FAKE_GROK_ARGS_FILE;
  const payload = {
    args,
    promptLength: prompt.length,
    hasAlwaysApprove: args.includes("--always-approve"),
    hasStreaming: wantsStreaming,
    hasPromptJsonFile: args.includes("--prompt-file") && args.some((value) => String(value).endsWith(".json")),
    tools: (() => {
      const index = args.indexOf("--tools");
      return index !== -1 ? args[index + 1] : null;
    })()
  };
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

if (mode === "imagine-ok") {
  emit({
    text: "Generated image saved to /tmp/fake-session/images/1.jpg",
    sessionId: "session-imagine-1",
    stopReason: "EndTurn"
  });
}

// Mirrors real Grok --json-schema behavior: the JSON verdict arrives in
// `structuredOutput` while `text` is ordinary prose.
if (mode === "structured-only") {
  emit({
    text: "Review complete. See structured output.",
    sessionId: "session-structured-1",
    stopReason: "EndTurn",
    structuredOutput: {
      verdict: "needs-attention",
      summary: "Structured-only issue found.",
      findings: [
        {
          severity: "high",
          title: "Structured-only finding",
          body: "Delivered via structuredOutput, not text.",
          file: "src/example.js",
          line_start: 1,
          line_end: 2,
          confidence: 0.9,
          recommendation: "Handle structuredOutput."
        }
      ],
      next_steps: []
    }
  });
}

const effectiveMode =
  mode === "auto"
    ? prompt.includes("Call the image_gen tool") ||
      prompt.includes("Call the image_edit tool") ||
      prompt.includes("# Imagine Video")
      ? "imagine-ok"
      : prompt.includes("adversarial") ||
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
      message: "task failed in fake grok"
    },
    1
  );
}

if (effectiveMode === "empty") {
  process.stdout.write("");
  process.exit(0);
}

if (effectiveMode === "imagine-ok") {
  emit({
    text: "Generated image saved to /tmp/fake-session/images/1.jpg",
    sessionId: "session-imagine-1",
    stopReason: "EndTurn"
  });
}

emit(
  {
    type: "error",
    message: `Unknown FAKE_GROK_MODE: ${effectiveMode}`
  },
  1
);
