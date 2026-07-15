import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { COMPANION, initGitRepo, makeTempDir, runCompanion } from "./helpers.mjs";

test("help lists expected subcommands", () => {
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

test("imagine uses official image_gen instruction and media tool allowlist", () => {
  const cwd = initGitRepo(makeTempDir("cmd-imagine-"));
  const pluginData = makeTempDir("pdata-imagine-");
  const argsFile = `${pluginData}/args.json`;

  const result = runCompanion(["imagine", "--json", "a golden sunset over the ocean"], {
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
  assert.match(dump.args.join(" "), /image_gen|Call the image_gen/);
  // Prompt is in -p or reconstructed from echo; check tools allowlist includes image_gen
  assert.ok(dump.tools && dump.tools.includes("image_gen"), `tools=${dump.tools}`);
  assert.ok(dump.hasAlwaysApprove);

  const payload = JSON.parse(result.stdout);
  assert.ok(payload.rawOutput || payload.mediaPaths);
});

test("imagine-video expands to video workflow instruction", () => {
  const cwd = initGitRepo(makeTempDir("cmd-imgvid-"));
  const result = runCompanion(["imagine-video", "--json", "a cat playing piano"], {
    cwd,
    pluginData: makeTempDir("pdata-imgvid-"),
    env: {
      XAI_API_KEY: "k",
      FAKE_GROK_MODE: "imagine-ok"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rawOutput, /images\/1\.jpg|Generated image/i);
});
