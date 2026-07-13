import test from "node:test";
import assert from "node:assert/strict";

import { cleanupSessionJobs } from "../plugins/grok/scripts/session-lifecycle-hook.mjs";
import { listJobs, upsertJob, writeJobFile } from "../plugins/grok/scripts/lib/state.mjs";
import { initGitRepo, makeTempDir } from "./helpers.mjs";

test("SessionEnd kills running jobs but retains finished ones", () => {
  const cwd = initGitRepo(makeTempDir("sess-life-"));
  const pluginData = makeTempDir("pdata-life-");
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  const sessionId = "claude-sess-1";

  const running = {
    id: "task-running-1",
    status: "running",
    phase: "running",
    pid: 999_999_991,
    sessionId,
    jobClass: "task",
    kind: "task",
    title: "Running",
    workspaceRoot: cwd
  };
  const finished = {
    id: "task-done-1",
    status: "completed",
    phase: "done",
    pid: null,
    sessionId,
    threadId: "session-abc",
    jobClass: "task",
    kind: "task",
    title: "Done",
    workspaceRoot: cwd
  };

  writeJobFile(cwd, running.id, running);
  writeJobFile(cwd, finished.id, finished);
  upsertJob(cwd, running);
  upsertJob(cwd, finished);

  const result = cleanupSessionJobs(cwd, sessionId);
  assert.equal(result.killed, 1);
  assert.equal(result.retained, 2);

  const jobs = listJobs(cwd);
  const done = jobs.find((j) => j.id === finished.id);
  const wasRunning = jobs.find((j) => j.id === running.id);
  assert.ok(done, "finished job retained");
  assert.equal(done.status, "completed");
  assert.ok(wasRunning, "running job retained as cancelled record");
  assert.equal(wasRunning.status, "cancelled");
  assert.equal(wasRunning.pid, null);
});
