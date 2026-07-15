import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../plugins/grok/scripts/lib/args.mjs";

test("parseArgs handles booleans, values, and positionals", () => {
  const { options, positionals } = parseArgs(
    ["--background", "--model", "grok-build", "--effort=high", "fix the bug"],
    {
      booleanOptions: ["background"],
      valueOptions: ["model", "effort"]
    }
  );
  assert.equal(options.background, true);
  assert.equal(options.model, "grok-build");
  assert.equal(options.effort, "high");
  assert.deepEqual(positionals, ["fix the bug"]);
});

test("splitRawArgumentString respects quotes", () => {
  const tokens = splitRawArgumentString(`--base main "focus on auth"`);
  assert.deepEqual(tokens, ["--base", "main", "focus on auth"]);
});

test("parseArgs collects multi-value options", () => {
  const { options, positionals } = parseArgs(
    ["--image", "a.png", "--image=b.jpg", "describe these"],
    {
      multiValueOptions: ["image"]
    }
  );
  assert.deepEqual(options.image, ["a.png", "b.jpg"]);
  assert.deepEqual(positionals, ["describe these"]);
});
