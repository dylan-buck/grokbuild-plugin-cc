import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { generateJobId, getConfig, listJobs, setConfig, upsertJob } from "../plugins/grok/scripts/lib/state.mjs";
import { makeTempDir } from "./helpers.mjs";

test("state store persists jobs and config under CLAUDE_PLUGIN_DATA", () => {
  const pluginData = makeTempDir("grok-state-");
  const cwd = makeTempDir("grok-workspace-");
  process.env.CLAUDE_PLUGIN_DATA = pluginData;

  setConfig(cwd, "stopReviewGate", true);
  assert.equal(getConfig(cwd).stopReviewGate, true);

  const id = generateJobId("task");
  upsertJob(cwd, {
    id,
    status: "running",
    kind: "task",
    jobClass: "task",
    title: "Grok Task"
  });

  const jobs = listJobs(cwd);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, id);
  assert.equal(jobs[0].status, "running");

  const stateRoot = path.join(pluginData, "state");
  assert.ok(fs.existsSync(stateRoot));
});
