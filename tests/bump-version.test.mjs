import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BUMP = path.join(ROOT, "scripts/bump-version.mjs");

test("bump-version --check passes for consistent manifests", () => {
  const result = spawnSync(process.execPath, [BUMP, "--check"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: version/);
});
