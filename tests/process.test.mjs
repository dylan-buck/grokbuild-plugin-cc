import test from "node:test";
import assert from "node:assert/strict";

import { binaryAvailable, formatCommandFailure, terminateProcessTree } from "../plugins/grok/scripts/lib/process.mjs";

test("binaryAvailable finds node", () => {
  const status = binaryAvailable("node", ["--version"]);
  assert.equal(status.available, true);
});

test("formatCommandFailure includes exit code", () => {
  const message = formatCommandFailure({
    command: "false",
    args: [],
    status: 1,
    signal: null,
    stdout: "",
    stderr: "boom"
  });
  assert.match(message, /exit=1/);
  assert.match(message, /boom/);
});

test("terminateProcessTree handles missing pid gracefully", () => {
  const result = terminateProcessTree(Number.NaN);
  assert.equal(result.attempted, false);
});
