import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  isStopGateJob,
  parseStopReviewOutput,
  runStopGateReview,
  shouldSkipStopGateForAssistantMessage
} from "../plugins/grok/scripts/lib/stop-gate.mjs";
import { initGitRepo, makeTempDir } from "./helpers.mjs";

test("shouldSkipStopGateForAssistantMessage skips status/setup noise", () => {
  assert.equal(shouldSkipStopGateForAssistantMessage(""), true);
  assert.equal(shouldSkipStopGateForAssistantMessage("# Grok Setup\nStatus: ready"), true);
  assert.equal(shouldSkipStopGateForAssistantMessage("Run a stop-gate review of the previous Claude turn."), true);
  assert.equal(
    shouldSkipStopGateForAssistantMessage("I fixed the null check in auth.js and updated the tests."),
    false
  );
});

test("parseStopReviewOutput handles ALLOW/BLOCK and structured JSON", () => {
  assert.equal(parseStopReviewOutput("ALLOW: clean").ok, true);
  assert.equal(parseStopReviewOutput("BLOCK: bad race").ok, false);
  assert.match(parseStopReviewOutput("BLOCK: bad race").reason, /bad race/);

  const structured = parseStopReviewOutput(
    JSON.stringify({
      verdict: "needs-attention",
      summary: "Issue",
      findings: [{ title: "Null deref", severity: "high" }],
      next_steps: []
    })
  );
  assert.equal(structured.ok, false);
  assert.match(structured.reason, /Null deref/);

  const approve = parseStopReviewOutput(
    JSON.stringify({ verdict: "approve", summary: "ok", findings: [], next_steps: [] })
  );
  assert.equal(approve.ok, true);
});

test("isStopGateJob detects gate jobs", () => {
  assert.equal(isStopGateJob({ title: "Grok Stop Gate Review" }), true);
  assert.equal(isStopGateJob({ summary: "Stop-gate review of previous Claude turn" }), true);
  assert.equal(isStopGateJob({ title: "Grok Task" }), false);
});

test("runStopGateReview allows clean tree without calling Grok", async () => {
  const cwd = initGitRepo(makeTempDir("stop-clean-"));
  let called = 0;
  const result = await runStopGateReview(
    cwd,
    { last_assistant_message: "I fixed auth.js" },
    {
      runHeadlessTurnImpl: async () => {
        called += 1;
        return { text: "ALLOW: ok", status: 0 };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(called, 0);
});

test("runStopGateReview blocks on structured needs-attention when dirty", async () => {
  const cwd = initGitRepo(makeTempDir("stop-dirty-"));
  fs.writeFileSync(path.join(cwd, "bug.js"), "export const x = null; x.y\n", "utf8");

  const result = await runStopGateReview(
    cwd,
    { last_assistant_message: "I fixed the login flow and edited bug.js" },
    {
      runHeadlessTurnImpl: async () => ({
        status: 0,
        text: JSON.stringify({
          verdict: "needs-attention",
          summary: "Still broken",
          findings: [{ title: "Null deref", severity: "high", body: "x may be null", file: "bug.js", line_start: 1, line_end: 1, confidence: 0.9, recommendation: "guard" }],
          next_steps: ["fix it"]
        })
      })
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /Null deref/);
});

test("runStopGateReview allows structured approve when dirty", async () => {
  const cwd = initGitRepo(makeTempDir("stop-ok-"));
  fs.writeFileSync(path.join(cwd, "ok.js"), "export const n = 1\n", "utf8");
  const result = await runStopGateReview(
    cwd,
    { last_assistant_message: "I updated ok.js safely" },
    {
      runHeadlessTurnImpl: async () => ({
        status: 0,
        text: JSON.stringify({
          verdict: "approve",
          summary: "Looks good",
          findings: [],
          next_steps: []
        })
      })
    }
  );
  assert.equal(result.ok, true);
});
