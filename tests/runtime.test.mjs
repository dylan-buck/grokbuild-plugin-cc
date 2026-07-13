import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { initGitRepo, makeTempDir, runCompanion } from "./helpers.mjs";

test("setup --json reports ready with fake grok + auth", () => {
  const cwd = initGitRepo(makeTempDir("grok-setup-"));
  const pluginData = makeTempDir("grok-pdata-");
  const home = makeTempDir("grok-home-");
  fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
  fs.writeFileSync(path.join(home, ".grok", "auth.json"), JSON.stringify({ token: "x" }), "utf8");

  const result = runCompanion(["setup", "--json", "--skip-live-auth"], {
    cwd,
    pluginData,
    env: {
      HOME: home,
      XAI_API_KEY: ""
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.grok.available, true);
  assert.equal(payload.auth.loggedIn, true);
});

test("setup can enable review gate", () => {
  const cwd = initGitRepo(makeTempDir("grok-gate-"));
  const pluginData = makeTempDir("grok-pdata-gate-");
  const result = runCompanion(["setup", "--enable-review-gate", "--json", "--skip-live-auth"], {
    cwd,
    pluginData,
    env: { XAI_API_KEY: "test-key" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reviewGateEnabled, true);
  assert.ok(payload.actionsTaken.some((a) => /Enabled/.test(a)));
});

test("review returns structured findings via fake grok", () => {
  const cwd = initGitRepo(makeTempDir("grok-review-"));
  fs.writeFileSync(path.join(cwd, "src.js"), "const x = null;\nx.y;\n", "utf8");
  const pluginData = makeTempDir("grok-pdata-review-");

  const result = runCompanion(["review", "--json"], {
    cwd,
    pluginData,
    env: {
      FAKE_GROK_MODE: "review-json",
      XAI_API_KEY: "test-key"
    }
  });

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review, "Review");
  assert.equal(payload.result.verdict, "needs-attention");
  assert.ok(payload.threadId);
});

test("task returns text and session id", () => {
  const cwd = initGitRepo(makeTempDir("grok-task-"));
  const pluginData = makeTempDir("grok-pdata-task-");

  const result = runCompanion(["task", "--write", "--json", "fix the failing test"], {
    cwd,
    pluginData,
    env: {
      FAKE_GROK_MODE: "task-ok",
      XAI_API_KEY: "test-key"
    }
  });

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rawOutput, /Task completed/);
  assert.equal(payload.threadId, "session-task-1");
});

test("status lists finished jobs", () => {
  const cwd = initGitRepo(makeTempDir("grok-status-"));
  const pluginData = makeTempDir("grok-pdata-status-");
  const envBase = {
    FAKE_GROK_MODE: "task-ok",
    XAI_API_KEY: "test-key"
  };

  const task = runCompanion(["task", "--write", "--json", "do something"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(task.status, 0, task.stderr);

  const status = runCompanion(["status", "--json", "--all"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.ok(report.latestFinished || report.recent.length > 0 || report.running.length >= 0);
  assert.ok(report.latestFinished, "expected a finished job");
});

test("result returns stored task output", () => {
  const cwd = initGitRepo(makeTempDir("grok-result-"));
  const pluginData = makeTempDir("grok-pdata-result-");
  const envBase = {
    FAKE_GROK_MODE: "task-ok",
    XAI_API_KEY: "test-key"
  };

  const task = runCompanion(["task", "--write", "--json", "ship it"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(task.status, 0, task.stderr);
  const taskPayload = JSON.parse(task.stdout);

  const result = runCompanion(["result", "--json"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.job);
  assert.ok(payload.storedJob);
  assert.equal(payload.job.threadId || payload.storedJob.threadId, taskPayload.threadId);
});

test("task-resume-candidate reports available after a task", () => {
  const cwd = initGitRepo(makeTempDir("grok-resume-cand-"));
  const pluginData = makeTempDir("grok-pdata-resume-");
  const sessionId = "claude-session-1";
  const envBase = {
    FAKE_GROK_MODE: "task-ok",
    XAI_API_KEY: "test-key",
    GROK_COMPANION_SESSION_ID: sessionId
  };

  const task = runCompanion(["task", "--write", "--json", "initial work"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(task.status, 0, task.stderr);

  const candidate = runCompanion(["task-resume-candidate", "--json"], {
    cwd,
    pluginData,
    env: envBase
  });
  assert.equal(candidate.status, 0, candidate.stderr);
  const payload = JSON.parse(candidate.stdout);
  assert.equal(payload.available, true);
  assert.ok(payload.candidate.threadId);
});
