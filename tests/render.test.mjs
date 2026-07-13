import test from "node:test";
import assert from "node:assert/strict";

import { renderReviewResult, renderSetupReport } from "../plugins/grok/scripts/lib/render.mjs";

test("renderReviewResult formats findings", () => {
  const rendered = renderReviewResult(
    {
      parsed: {
        verdict: "needs-attention",
        summary: "Ship risk present.",
        findings: [
          {
            severity: "high",
            title: "Null deref",
            body: "x may be null",
            file: "a.js",
            line_start: 1,
            line_end: 2,
            recommendation: "Add a guard"
          }
        ],
        next_steps: ["Add a test"]
      },
      parseError: null,
      rawOutput: "{}"
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(rendered, /# Grok Review/);
  assert.match(rendered, /Null deref/);
  assert.match(rendered, /needs-attention/);
});

test("renderSetupReport includes checks", () => {
  const report = renderSetupReport({
    ready: false,
    node: { detail: "v22" },
    grok: { detail: "not found" },
    auth: { detail: "missing" },
    sessionRuntime: { label: "headless process" },
    reviewGateEnabled: false,
    actionsTaken: [],
    nextSteps: ["Install Grok"]
  });
  assert.match(report, /# Grok Setup/);
  assert.match(report, /Install Grok/);
});
