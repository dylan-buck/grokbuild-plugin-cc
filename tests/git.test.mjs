import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { collectReviewContext, getWorkingTreeState, resolveReviewTarget } from "../plugins/grok/scripts/lib/git.mjs";
import { initGitRepo, makeTempDir, runCompanion } from "./helpers.mjs";

test("resolveReviewTarget prefers dirty working tree", () => {
  const dir = initGitRepo(makeTempDir("grok-git-"));
  fs.writeFileSync(path.join(dir, "dirty.txt"), "x\n", "utf8");
  const target = resolveReviewTarget(dir);
  assert.equal(target.mode, "working-tree");
  const state = getWorkingTreeState(dir);
  assert.equal(state.isDirty, true);
});

test("collectReviewContext embeds untracked content", () => {
  const dir = initGitRepo(makeTempDir("grok-git-ctx-"));
  fs.writeFileSync(path.join(dir, "new-file.js"), "export const x = 1;\n", "utf8");
  const target = resolveReviewTarget(dir, { scope: "working-tree" });
  const context = collectReviewContext(dir, target, { includeDiff: true });
  assert.ok(context.content.includes("new-file.js"));
  assert.ok(context.fileCount >= 1);
});

test("review errors on empty working tree", () => {
  const dir = initGitRepo(makeTempDir("grok-empty-review-"));
  const result = runCompanion(["review", "--json", "--scope", "working-tree"], {
    cwd: dir,
    pluginData: makeTempDir("pdata-empty-review-"),
    env: { XAI_API_KEY: "k", FAKE_GROK_MODE: "review-json" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Nothing to review/i);
});

test("branch scope uses base ref", () => {
  const dir = initGitRepo(makeTempDir("grok-git-branch-"));
  spawnSync("git", ["checkout", "-b", "feature"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n", "utf8");
  spawnSync("git", ["add", "feature.txt"], { cwd: dir });
  spawnSync("git", ["commit", "-m", "feature"], { cwd: dir });

  const target = resolveReviewTarget(dir, { base: "main" });
  // Some repos use master as default after init; fall back to HEAD~1 if main missing.
  if (target.mode !== "branch") {
    const alt = resolveReviewTarget(dir, { base: "HEAD~1" });
    assert.equal(alt.mode, "branch");
  } else {
    assert.equal(target.mode, "branch");
  }
});
