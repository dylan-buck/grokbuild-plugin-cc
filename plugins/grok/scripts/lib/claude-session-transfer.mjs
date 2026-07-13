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

function extractTextFromContent(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (!block || typeof block !== "object") {
          return "";
        }
        if (block.type === "text" && typeof block.text === "string") {
          return block.text;
        }
        if (typeof block.text === "string") {
          return block.text;
        }
        if (typeof block.content === "string") {
          return block.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    if (typeof content.content === "string") {
      return content.content;
    }
    if (Array.isArray(content.content)) {
      return extractTextFromContent(content.content);
    }
  }
  return "";
}

function normalizeRole(role, type) {
  const raw = String(role || type || "").toLowerCase();
  if (raw.includes("assistant") || raw === "ai" || raw === "model") {
    return "assistant";
  }
  if (raw.includes("user") || raw === "human") {
    return "user";
  }
  if (raw.includes("system")) {
    return "system";
  }
  return raw || "unknown";
}

/**
 * Parse Claude Code jsonl into ordered chat messages (best-effort across formats).
 */
export function extractClaudeMessages(sourcePath, options = {}) {
  const maxMessages = options.maxMessages ?? 80;
  const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/).filter(Boolean);
  const messages = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Common Claude Code shapes
    const role = entry?.message?.role || entry?.role || entry?.type;
    const content =
      entry?.message?.content ??
      entry?.content ??
      entry?.message ??
      entry?.text ??
      entry?.prompt ??
      entry?.response;

    // Skip tool-result only rows without text
    if (entry?.type === "tool_result" || entry?.type === "tool_use") {
      continue;
    }

    const text = extractTextFromContent(content).trim();
    if (!text) {
      continue;
    }

    const normalizedRole = normalizeRole(role, entry?.type);
    if (normalizedRole === "system" || normalizedRole === "unknown") {
      continue;
    }

    // Drop pure command/tool dump noise
    if (text.startsWith("tool_use") || text.startsWith("<tool")) {
      continue;
    }

    messages.push({ role: normalizedRole, text });
  }

  return messages.slice(-maxMessages);
}

/**
 * Build a best-effort handoff markdown from a Claude Code jsonl transcript.
 */
export function buildHandoffMarkdown(sourcePath, options = {}) {
  const maxChars = options.maxChars ?? 120_000;
  const messages = extractClaudeMessages(sourcePath, options);
  const userCount = messages.filter((m) => m.role === "user").length;
  const assistantCount = messages.filter((m) => m.role === "assistant").length;

  const parts = [
    "# Claude → Grok handoff",
    "",
    "Continue this work in Grok Build. Below is a condensed transcript from Claude Code.",
    "",
    `Source: ${sourcePath}`,
    `Extracted turns: ${messages.length} (user=${userCount}, assistant=${assistantCount})`,
    `Generated: ${new Date().toISOString()}`,
    ""
  ];

  if (messages.length === 0) {
    parts.push(
      "## Note",
      "",
      "No user/assistant text turns could be extracted from this transcript.",
      "Open the source JSONL or re-run transfer with a fuller Claude session.",
      ""
    );
  }

  for (const message of messages) {
    parts.push(`## ${message.role}`, "", message.text, "");
  }

  parts.push(
    "## Instructions for Grok",
    "",
    "Pick up from the latest user request. Prefer the smallest safe change that completes the task.",
    "Do not re-litigate earlier resolved steps unless needed for correctness.",
    "If context looks incomplete, ask one clarifying question before large refactors."
  );

  let body = parts.join("\n");
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n[...truncated for length...]\n`;
  }
  return body;
}
