import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureAbsolutePath } from "./fs.mjs";
import { TRANSCRIPT_PATH_ENV } from "./tracked-jobs.mjs";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function resolveUserPath(cwd, value) {
  if (value === "~") {
    return os.homedir();
  }
  if (String(value).startsWith("~/")) {
    return path.join(os.homedir(), String(value).slice(2));
  }
  return ensureAbsolutePath(cwd, value);
}

export function resolveClaudeSessionPath(cwd, options = {}) {
  const requestedPath = options.source || process.env[TRANSCRIPT_PATH_ENV];
  if (!requestedPath) {
    throw new Error("Could not identify the current Claude transcript. Retry with --source <path-to-claude-jsonl>.");
  }

  const sourcePath = resolveUserPath(cwd, requestedPath);
  if (path.extname(sourcePath) !== ".jsonl") {
    throw new Error(`Claude session source must be a JSONL file: ${sourcePath}`);
  }

  let source;
  let projects;
  try {
    source = fs.realpathSync(sourcePath);
    projects = fs.realpathSync(CLAUDE_PROJECTS_DIR);
  } catch {
    throw new Error(`Claude session file not found: ${sourcePath}`);
  }
  const relative = path.relative(projects, source);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Grok transfer accepts Claude sessions only from ${CLAUDE_PROJECTS_DIR}: ${source}`);
  }
  return source;
}

/**
 * Build a best-effort handoff markdown from a Claude Code jsonl transcript.
 * Extracts recent user/assistant text blocks for pasting into Grok.
 */
export function buildHandoffMarkdown(sourcePath, options = {}) {
  const maxMessages = options.maxMessages ?? 40;
  const maxChars = options.maxChars ?? 120_000;
  const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/).filter(Boolean);
  const messages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const role = entry?.message?.role || entry?.role || entry?.type;
    const content = entry?.message?.content ?? entry?.content ?? entry?.message;
    if (!role || !content) {
      continue;
    }

    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((block) => {
          if (typeof block === "string") {
            return block;
          }
          if (block?.type === "text" && typeof block.text === "string") {
            return block.text;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    } else if (typeof content === "object" && typeof content.text === "string") {
      text = content.text;
    }

    text = text.trim();
    if (!text) {
      continue;
    }

    const normalizedRole = String(role).toLowerCase().includes("assistant")
      ? "assistant"
      : String(role).toLowerCase().includes("user")
        ? "user"
        : String(role);

    messages.push({ role: normalizedRole, text });
  }

  const selected = messages.slice(-maxMessages);
  const parts = [
    "# Claude → Grok handoff",
    "",
    "Continue this work in Grok Build. Below is a condensed transcript from Claude Code.",
    "",
    `Source: ${sourcePath}`,
    ""
  ];

  for (const message of selected) {
    parts.push(`## ${message.role}`, "", message.text, "");
  }

  parts.push(
    "## Instructions for Grok",
    "",
    "Pick up from the latest user request. Prefer the smallest safe change that completes the task.",
    "Do not re-litigate earlier resolved steps unless needed for correctness."
  );

  let body = parts.join("\n");
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n[...truncated for length...]\n`;
  }
  return body;
}
