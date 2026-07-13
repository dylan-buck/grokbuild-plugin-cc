import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { COMPANION, initGitRepo, makeTempDir, runCompanion } from "./helpers.mjs";

test("help lists expected subcommands", () => {
  const result = spawnSync(process.execPath, [COMPANION, "help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  for (const name of ["setup", "review", "adversarial-review", "task", "transfer", "status", "result", "cancel"]) {
    assert.match(result.stdout, new RegExp(name));
  }
});

test("unknown subcommand fails", () => {
  const result = spawnSync(process.execPath, [COMPANION, "nope"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown subcommand/);
});

test("setup json schema has required fields", () => {
  const cwd = initGitRepo(makeTempDir("cmd-setup-"));
  const result = runCompanion(["setup", "--json", "--skip-live-auth"], {
    cwd,
    pluginData: makeTempDir("pdata-cmd-setup-"),
    env: { XAI_API_KEY: "k" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  for (const key of ["ready", "node", "grok", "auth", "sessionRuntime", "reviewGateEnabled", "nextSteps"]) {
    assert.ok(key in payload, `missing ${key}`);
  }
});

test("large prompt uses --prompt-file against fake grok", () => {
  const cwd = initGitRepo(makeTempDir("cmd-large-"));
  const pluginData = makeTempDir("pdata-large-");
  const argsFile = `${pluginData}/args.json`;
  const huge = "x".repeat(30 * 1024);

  const result = runCompanion(["task", "--write", "--json", huge], {
    cwd,
    pluginData,
    env: {
      XAI_API_KEY: "k",
      FAKE_GROK_MODE: "echo-args",
      FAKE_GROK_ARGS_FILE: argsFile
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const dump = JSON.parse(fs.readFileSync(argsFile, "utf8"));
  assert.ok(dump.args.includes("--prompt-file"), `expected prompt-file in ${JSON.stringify(dump.args)}`);
  assert.ok(dump.hasAlwaysApprove);
  assert.ok(dump.promptLength >= 30 * 1024);
});
