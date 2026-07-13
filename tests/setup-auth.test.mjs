import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { initGitRepo, makeTempDir, runCompanion } from "./helpers.mjs";

test("setup --skip-live-auth reports live probe skipped", () => {
  const cwd = initGitRepo(makeTempDir("setup-skip-"));
  const result = runCompanion(["setup", "--json", "--skip-live-auth"], {
    cwd,
    pluginData: makeTempDir("pdata-skip-"),
    env: { XAI_API_KEY: "test-key" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.auth.liveVerified, null);
  assert.match(payload.auth.detail, /skipped/i);
});

test("setup live probe failure marks not ready", () => {
  const cwd = initGitRepo(makeTempDir("setup-fail-"));
  const home = makeTempDir("home-fail-");
  fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
  fs.writeFileSync(path.join(home, ".grok", "auth.json"), JSON.stringify({ token: "stale" }), "utf8");

  const result = runCompanion(["setup", "--json"], {
    cwd,
    pluginData: makeTempDir("pdata-fail-"),
    env: {
      HOME: home,
      XAI_API_KEY: "",
      FAKE_GROK_MODE: "auth-fail"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
  assert.equal(payload.auth.liveVerified, false);
  assert.match(payload.auth.detail, /live probe failed/i);
});

test("setup live probe success marks ready", () => {
  const cwd = initGitRepo(makeTempDir("setup-ok-"));
  const result = runCompanion(["setup", "--json"], {
    cwd,
    pluginData: makeTempDir("pdata-ok-"),
    env: {
      XAI_API_KEY: "test-key",
      FAKE_GROK_MODE: "task-ok"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.auth.liveVerified, true);
});
