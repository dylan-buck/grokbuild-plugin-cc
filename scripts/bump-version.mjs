#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const TARGETS = [
  {
    file: "package.json",
    values: [
      {
        label: "version",
        get: (json) => json.version,
        set: (json, version) => {
          json.version = version;
        }
      }
    ]
  },
  {
    file: "package-lock.json",
    values: [
      {
        label: "version",
        get: (json) => json.version,
        set: (json, version) => {
          json.version = version;
        }
      },
      {
        label: 'packages[""].version',
        get: (json) => json.packages?.[""]?.version,
        set: (json, version) => {
          if (!json.packages?.[""]) {
            throw new Error('package-lock.json packages[""] is missing');
          }
          json.packages[""].version = version;
        }
      }
    ]
  },
  {
    file: "plugins/grok/.claude-plugin/plugin.json",
    values: [
      {
        label: "version",
        get: (json) => json.version,
        set: (json, version) => {
          json.version = version;
        }
      }
    ]
  },
  {
    file: ".claude-plugin/marketplace.json",
    values: [
      {
        label: "metadata.version",
        get: (json) => json.metadata?.version,
        set: (json, version) => {
          if (!json.metadata) {
            throw new Error("marketplace metadata is missing");
          }
          json.metadata.version = version;
        }
      },
      {
        label: "plugins[grok].version",
        get: (json) => json.plugins?.find((p) => p.name === "grok")?.version,
        set: (json, version) => {
          const plugin = json.plugins?.find((p) => p.name === "grok");
          if (!plugin) {
            throw new Error("marketplace plugins[grok] is missing");
          }
          plugin.version = version;
        }
      }
    ]
  }
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/bump-version.mjs <version>",
    "  node scripts/bump-version.mjs --check [version]",
    "",
    "Updates or verifies the plugin version across package, lockfile, plugin, and marketplace manifests."
  ].join("\n");
}

function collectVersions() {
  const found = [];
  for (const target of TARGETS) {
    if (!fs.existsSync(target.file)) {
      if (target.file === "package-lock.json") {
        continue;
      }
      throw new Error(`Missing ${target.file}`);
    }
    const json = readJson(target.file);
    for (const value of target.values) {
      found.push({
        file: target.file,
        label: value.label,
        version: value.get(json)
      });
    }
  }
  return found;
}

function assertConsistent(found, expected) {
  for (const entry of found) {
    if (typeof entry.version !== "string" || !VERSION_PATTERN.test(entry.version)) {
      throw new Error(`${entry.file} ${entry.label} is not a valid semver: ${entry.version}`);
    }
    if (expected && entry.version !== expected) {
      throw new Error(`${entry.file} ${entry.label} is ${entry.version}, expected ${expected}`);
    }
  }
  const unique = new Set(found.map((entry) => entry.version));
  if (unique.size !== 1) {
    throw new Error(`Version mismatch: ${found.map((e) => `${e.file}:${e.version}`).join(", ")}`);
  }
  return [...unique][0];
}

function setVersion(version) {
  for (const target of TARGETS) {
    if (!fs.existsSync(target.file)) {
      if (target.file === "package-lock.json") {
        continue;
      }
      throw new Error(`Missing ${target.file}`);
    }
    const json = readJson(target.file);
    for (const value of target.values) {
      value.set(json, version);
    }
    writeJson(target.file, json);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }

  if (args[0] === "--check") {
    const expected = args[1] ?? null;
    if (expected && !VERSION_PATTERN.test(expected)) {
      throw new Error(`Invalid version: ${expected}`);
    }
    const current = assertConsistent(collectVersions(), expected);
    console.log(`OK: version ${current}`);
    return;
  }

  const version = args[0];
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  setVersion(version);
  assertConsistent(collectVersions(), version);
  console.log(`Bumped version to ${version}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
