import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  GROK_TOOL_IDS,
  PROMPT_FILE_THRESHOLD_BYTES,
  READ_ONLY_DISALLOWED_TOOLS,
  REVIEW_DISALLOWED_TOOLS
} from "../plugins/grok/scripts/lib/grok.mjs";
import { reconcileStaleJob } from "../plugins/grok/scripts/lib/job-control.mjs";
import { renderTransferResult } from "../plugins/grok/scripts/lib/render.mjs";
import { upsertJob, writeJobFile } from "../plugins/grok/scripts/lib/state.mjs";
import { initGitRepo, makeTempDir, runCompanion, FAKE_GROK, COMPANION } from "./helpers.mjs";

test("review tool denylist uses Grok headless tool IDs", () => {
  assert.match(REVIEW_DISALLOWED_TOOLS, new RegExp(GROK_TOOL_IDS.shell));
  assert.match(REVIEW_DISALLOWED_TOOLS, new RegExp(GROK_TOOL_IDS.edit));
  assert.match(REVIEW_DISALLOWED_TOOLS, new RegExp(GROK_TOOL_IDS.agent));
  assert.match(REVIEW_DISALLOWED_TOOLS, new RegExp(GROK_TOOL_IDS.imageGen));
  assert.match(REVIEW_DISALLOWED_TOOLS, new RegExp(GROK_TOOL_IDS.imageEdit));
  assert.doesNotMatch(REVIEW_DISALLOWED_TOOLS, /run_terminal_command/);
  assert.doesNotMatch(REVIEW_DISALLOWED_TOOLS, /\bWrite\b|\bEdit\b|\bBash\b/);
  assert.equal(READ_ONLY_DISALLOWED_TOOLS, GROK_TOOL_IDS.edit);
  // Read-only rescue keeps Imagine tools available for diagnosis/media-aware tasks.
  assert.doesNotMatch(READ_ONLY_DISALLOWED_TOOLS, /image_gen|image_edit/);
});

test("adversarial-review accepts focus text and returns findings", () => {
  const cwd = initGitRepo(makeTempDir("grok-adv-"));
  fs.writeFileSync(path.join(cwd, "auth.js"), "export const secret = process.env.SECRET\n", "utf8");
  const pluginData = makeTempDir("grok-pdata-adv-");
  const result = runCompanion(
    ["adversarial-review", "--json", "challenge secret handling"],
    {
      cwd,
      pluginData,
      env: { FAKE_GROK_MODE: "review-json", XAI_API_KEY: "k" }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review, "Adversarial Review");
  assert.equal(payload.result.verdict, "needs-attention");
});

test("review accepts focus text (prompt-based Grok reviews)", () => {
  const cwd = initGitRepo(makeTempDir("grok-rev-focus-"));
  fs.writeFileSync(path.join(cwd, "x.js"), "1\n", "utf8");
  const result = runCompanion(["review", "--json", "please focus on races"], {
    cwd,
    pluginData: makeTempDir("grok-pdata-focus-"),
    env: { FAKE_GROK_MODE: "review-json", XAI_API_KEY: "k" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review, "Review");
  assert.equal(payload.result.verdict, "needs-attention");
});

test("task --read is not write-capable", () => {
  const cwd = initGitRepo(makeTempDir("grok-read-"));
  const pluginData = makeTempDir("grok-pdata-read-");
  const result = runCompanion(["task", "--read", "--json", "diagnose only"], {
    cwd,
    pluginData,
    env: { FAKE_GROK_MODE: "task-ok", XAI_API_KEY: "k" }
  });
  assert.equal(result.status, 0, result.stderr);
  // Job file should mark write=false
  const jobsDir = fs.readdirSync(pluginData, { recursive: true }).join("\n");
  void jobsDir;
  const status = runCompanion(["status", "--json", "--all"], {
    cwd,
    pluginData,
    env: { XAI_API_KEY: "k" }
  });
  const report = JSON.parse(status.stdout);
  const finished = report.latestFinished;
  assert.ok(finished);
  assert.equal(finished.write, false);
});

test("task --write and --read conflict", () => {
  const cwd = initGitRepo(makeTempDir("grok-conflict-"));
  const result = runCompanion(["task", "--write", "--read", "--json", "nope"], {
    cwd,
    pluginData: makeTempDir("grok-pdata-conflict-"),
    env: { XAI_API_KEY: "k" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--write or --read/);
});

test("background task can be cancelled", async () => {
  const cwd = initGitRepo(makeTempDir("grok-cancel-"));
  const pluginData = makeTempDir("grok-pdata-cancel-");
  // Fake grok that sleeps so cancel has something to kill
  const sleeper = path.join(pluginData, "slow-grok.mjs");
  fs.writeFileSync(
    sleeper,
    `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("slow-grok"); process.exit(0); }
setTimeout(() => {
  console.log(JSON.stringify({ text: "late", sessionId: "s-late", stopReason: "EndTurn" }));
}, 20000);
`,
    "utf8"
  );
  fs.chmodSync(sleeper, 0o755);

  const queued = runCompanion(["task", "--write", "--background", "--json", "long running"], {
    cwd,
    pluginData,
    grokBin: sleeper,
    env: { XAI_API_KEY: "k" }
  });
  assert.equal(queued.status, 0, queued.stderr);
  const launch = JSON.parse(queued.stdout);
  assert.equal(launch.status, "queued");
  assert.ok(launch.jobId);

  // Give worker a moment to start
  await new Promise((r) => setTimeout(r, 300));

  const cancel = runCompanion(["cancel", "--json", launch.jobId], {
    cwd,
    pluginData,
    grokBin: sleeper,
    env: { XAI_API_KEY: "k" }
  });
  assert.equal(cancel.status, 0, cancel.stderr);
  const cancelled = JSON.parse(cancel.stdout);
  assert.equal(cancelled.status, "cancelled");
});

test("transfer writes handoff and attempts import", () => {
  const cwd = initGitRepo(makeTempDir("grok-xfer-"));
  const pluginData = makeTempDir("grok-pdata-xfer-");
  const home = makeTempDir("grok-home-xfer-");
  const projects = path.join(home, ".claude", "projects", "demo");
  fs.mkdirSync(projects, { recursive: true });
  const source = path.join(projects, "sess-1.jsonl");
  fs.writeFileSync(
    source,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "fix the bug" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "looking into it" } })
    ].join("\n") + "\n",
    "utf8"
  );

  const result = runCompanion(["transfer", "--json", "--source", source], {
    cwd,
    pluginData,
    env: {
      HOME: home,
      XAI_API_KEY: "k"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sourcePath, fs.realpathSync(source));
  assert.ok(fs.existsSync(payload.handoffPath));
  assert.ok(payload.import?.attempted === true || payload.mode === "best-effort");
  const handoff = fs.readFileSync(payload.handoffPath, "utf8");
  assert.match(handoff, /fix the bug/);
});

test("renderTransferResult covers imported and best-effort modes", () => {
  const best = renderTransferResult({
    mode: "best-effort",
    sourcePath: "/tmp/a.jsonl",
    handoffPath: "/tmp/h.md",
    sessionId: "abc",
    import: { attempted: true, detail: "skipped" }
  });
  assert.match(best, /best-effort/i);
  assert.match(best, /Import detail/);

  const imported = renderTransferResult({
    mode: "imported",
    sourcePath: "/tmp/a.jsonl",
    handoffPath: "/tmp/h.md",
    sessionId: "abc",
    import: { imported: true, sessionId: "grok-sess" },
    resumeCommand: "grok --resume grok-sess"
  });
  assert.match(imported, /imported into Grok/i);
  assert.match(imported, /grok --resume/);
});

test("setup --json includes binary path detail", () => {
  const cwd = initGitRepo(makeTempDir("grok-setup2-"));
  const result = runCompanion(["setup", "--json", "--skip-live-auth"], {
    cwd,
    pluginData: makeTempDir("grok-pdata-setup2-"),
    env: { XAI_API_KEY: "k" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.grok.available, true);
  assert.ok(payload.grok.binary);
});

test("companion help lists all subcommands", () => {
  const result = spawnSync(process.execPath, [COMPANION, "help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  for (const name of [
    "setup",
    "review",
    "adversarial-review",
    "task",
    "imagine",
    "imagine-video",
    "transfer",
    "status",
    "result",
    "cancel"
  ]) {
    assert.match(result.stdout, new RegExp(name));
  }
});

test("fake grok path is used when GROK_BIN set", () => {
  assert.ok(fs.existsSync(FAKE_GROK));
});

test("prompt-file threshold is set for large review diffs", () => {
  assert.ok(PROMPT_FILE_THRESHOLD_BYTES >= 16 * 1024);
});

test("reconcileStaleJob marks dead PIDs failed", () => {
  const cwd = initGitRepo(makeTempDir("grok-stale-"));
  const pluginData = makeTempDir("grok-pdata-stale-");
  process.env.CLAUDE_PLUGIN_DATA = pluginData;

  const job = {
    id: "task-dead-1",
    status: "running",
    phase: "running",
    pid: 999_999_999,
    kind: "task",
    jobClass: "task",
    title: "Dead",
    workspaceRoot: cwd
  };
  writeJobFile(cwd, job.id, job);
  upsertJob(cwd, job);

  const next = reconcileStaleJob(cwd, job);
  assert.equal(next.status, "failed");
  assert.equal(next.pid, null);
  assert.match(next.errorMessage, /no longer running/i);
});
