import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const COMPANION = path.join(REPO_ROOT, "plugins/grok/scripts/grok-companion.mjs");
export const FAKE_GROK = path.join(REPO_ROOT, "tests/fake-grok.mjs");

export function makeTempDir(prefix = "grok-plugin-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function initGitRepo(dir) {
  const run = (args) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8"
    });

  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n", "utf8");
  run(["add", "README.md"]);
  run(["commit", "-m", "init"]);
  return dir;
}

export function runCompanion(args, options = {}) {
  const env = {
    ...process.env,
    ...options.env,
    GROK_BIN: options.grokBin ?? FAKE_GROK,
    CLAUDE_PLUGIN_DATA: options.pluginData ?? makeTempDir("grok-plugin-data-")
  };

  const result = spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? 30_000
  });

  return {
    ...result,
    env
  };
}
