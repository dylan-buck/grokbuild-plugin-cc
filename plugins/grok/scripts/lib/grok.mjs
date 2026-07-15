import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { binaryAvailable, runCommand } from "./process.mjs";

const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function resolveGrokBinary(env = process.env) {
  if (env.GROK_BIN && env.GROK_BIN.trim()) {
    return env.GROK_BIN.trim();
  }

  const home = env.HOME || os.homedir();
  const candidates = [
    path.join(home, ".grok", "bin", "grok"),
    path.join(home, ".local", "bin", "grok")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "grok";
}

export function getGrokAvailability(cwd, env = process.env) {
  const binary = resolveGrokBinary(env);
  const versionStatus = binaryAvailable(binary, ["--version"], { cwd, env });
  if (!versionStatus.available) {
    return {
      available: false,
      detail: versionStatus.detail,
      binary
    };
  }

  return {
    available: true,
    detail: versionStatus.detail,
    binary
  };
}

function authHome(env = process.env) {
  return env.GROK_HOME || path.join(env.HOME || os.homedir(), ".grok");
}

export function getGrokAuthStatus(cwd, env = process.env) {
  if (env.XAI_API_KEY && String(env.XAI_API_KEY).trim()) {
    return {
      available: true,
      loggedIn: true,
      detail: "XAI_API_KEY is set",
      source: "env",
      authMethod: "api-key",
      liveVerified: null
    };
  }

  const authPath = path.join(authHome(env), "auth.json");
  if (!fs.existsSync(authPath)) {
    return {
      available: true,
      loggedIn: false,
      detail: "No auth.json and no XAI_API_KEY. Run `grok login`.",
      source: "missing",
      authMethod: null,
      liveVerified: null
    };
  }

  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw);
    const hasEntries =
      (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) ||
      (Array.isArray(parsed) && parsed.length > 0);

    if (!hasEntries) {
      return {
        available: true,
        loggedIn: false,
        detail: "auth.json exists but is empty. Run `grok login`.",
        source: "auth.json",
        authMethod: null,
        liveVerified: null
      };
    }

    return {
      available: true,
      loggedIn: true,
      detail: "Cached credentials found in ~/.grok/auth.json",
      source: "auth.json",
      authMethod: "session",
      liveVerified: null
    };
  } catch (error) {
    return {
      available: true,
      loggedIn: false,
      detail: `Failed to read auth.json: ${error instanceof Error ? error.message : String(error)}`,
      source: "auth.json",
      authMethod: null,
      liveVerified: null
    };
  }
}

/**
 * Live probe: one tiny headless turn to verify credentials work.
 * @returns {Promise<{ liveVerified: boolean, detail: string }>}
 */
export async function probeGrokAuthLive(cwd, options = {}) {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const availability = getGrokAvailability(cwd, env);
  if (!availability.available) {
    return { liveVerified: false, detail: availability.detail };
  }

  try {
    const result = await runHeadlessTurn({
      prompt: "Reply with exactly: OK",
      cwd,
      env,
      alwaysApprove: true,
      noSubagents: true,
      disableWebSearch: true,
      maxTurns: 1,
      disallowedTools: REVIEW_DISALLOWED_TOOLS,
      timeoutMs
    });
    if (result.status === 0 && String(result.text ?? "").trim()) {
      return { liveVerified: true, detail: "Live headless probe succeeded" };
    }
    const detail =
      result.stderr ||
      result.parseError ||
      (result.text ? `Unexpected probe output: ${String(result.text).slice(0, 120)}` : "Live probe returned empty output");
    return { liveVerified: false, detail };
  } catch (error) {
    return {
      liveVerified: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export function normalizeReasoningEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Unsupported reasoning effort "${effort}". Use one of: none, minimal, low, medium, high, xhigh, max.`
    );
  }
  return normalized;
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Grok did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  const trimmed = String(rawOutput).trim();

  try {
    return {
      parsed: JSON.parse(trimmed),
      parseError: null,
      rawOutput: trimmed,
      ...fallback
    };
  } catch {
    // Fall through to fenced JSON extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return {
        parsed: JSON.parse(fenced[1].trim()),
        parseError: null,
        rawOutput: trimmed,
        ...fallback
      };
    } catch (error) {
      return {
        parsed: null,
        parseError: error.message,
        rawOutput: trimmed,
        ...fallback
      };
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return {
        parsed: JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)),
        parseError: null,
        rawOutput: trimmed,
        ...fallback
      };
    } catch (error) {
      return {
        parsed: null,
        parseError: error.message,
        rawOutput: trimmed,
        ...fallback
      };
    }
  }

  return {
    parsed: null,
    parseError: "Could not parse JSON from Grok output.",
    rawOutput: trimmed,
    ...fallback
  };
}

export function readOutputSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

/**
 * Canonical Grok headless tool IDs from open-source Grok Build
 * (xai-org/grok-build tools + user-guide/14-headless-mode.md).
 */
export const GROK_TOOL_IDS = {
  shell: "run_terminal_cmd",
  edit: "search_replace",
  // OpenCode-derived create-file tool, injected when no other write tool is present.
  write: "write",
  webSearch: "web_search",
  webFetch: "web_fetch",
  // `Agent` (and `Agent(type)`) is a filter-list directive that blocks subagent
  // spawning; the actual subagent tool id in the GrokBuild toolset is `task`.
  agent: "Agent",
  subagentTask: "task",
  todoWrite: "todo_write",
  read: "read_file",
  grep: "grep",
  list: "list_dir",
  imageGen: "image_gen",
  imageEdit: "image_edit",
  imageToVideo: "image_to_video",
  referenceToVideo: "reference_to_video"
};

/** Media / Imagine tools (optional SuperGrok feature set). */
export const MEDIA_TOOL_IDS = [
  GROK_TOOL_IDS.imageGen,
  GROK_TOOL_IDS.imageEdit,
  GROK_TOOL_IDS.imageToVideo,
  GROK_TOOL_IDS.referenceToVideo
];

/** Tools blocked for embedded-diff reviews (text-in/text-out). */
export const REVIEW_DISALLOWED_TOOLS = [
  GROK_TOOL_IDS.shell,
  GROK_TOOL_IDS.edit,
  GROK_TOOL_IDS.write,
  GROK_TOOL_IDS.webSearch,
  GROK_TOOL_IDS.webFetch,
  GROK_TOOL_IDS.agent,
  GROK_TOOL_IDS.subagentTask,
  GROK_TOOL_IDS.todoWrite,
  GROK_TOOL_IDS.read,
  GROK_TOOL_IDS.grep,
  GROK_TOOL_IDS.list,
  ...MEDIA_TOOL_IDS
].join(",");

/** Tools blocked for read-only investigation tasks (no file mutations). Media tools stay available. */
export const READ_ONLY_DISALLOWED_TOOLS = [GROK_TOOL_IDS.edit, GROK_TOOL_IDS.write].join(",");

/**
 * Allowlist for dedicated Imagine runs. Keeps the turn focused on media tools while
 * still allowing light web grounding (official /imagine injects only image_gen, but
 * the model may want web_search for factual subjects).
 */
export const IMAGINE_ALLOWED_TOOLS = [
  GROK_TOOL_IDS.imageGen,
  GROK_TOOL_IDS.imageEdit,
  GROK_TOOL_IDS.imageToVideo,
  GROK_TOOL_IDS.referenceToVideo,
  GROK_TOOL_IDS.webSearch,
  GROK_TOOL_IDS.webFetch,
  GROK_TOOL_IDS.read
].join(",");

/** Prefer --prompt-file over -p once the prompt risks OS argv limits or shell issues. */
export const PROMPT_FILE_THRESHOLD_BYTES = 24 * 1024;

/** Official /imagine expansion from xai-grok-tools-api (verbatim prompt contract). */
export function buildImagineInstruction(prompt) {
  return (
    "Call the image_gen tool immediately, passing the user's prompt below " +
    "verbatim — do not rewrite, embellish, or expand it. " +
    "After the tool completes, briefly acknowledge and mention " +
    "where the image was saved.\n\n" +
    `Prompt: ${prompt}`
  );
}

/** image_edit variant when the user supplies a source image path. */
export function buildImagineEditInstruction(prompt, imagePaths) {
  const paths = (Array.isArray(imagePaths) ? imagePaths : [imagePaths])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const pathList = paths.map((p) => `- ${p}`).join("\n");
  return (
    "Call the image_edit tool immediately with the source image path(s) below " +
    "and the user's prompt verbatim — do not rewrite, embellish, or expand the prompt. " +
    "Pass each path as an entry in the image parameter (absolute filesystem paths). " +
    "After the tool completes, briefly acknowledge and mention where the image was saved.\n\n" +
    `Source image path(s):\n${pathList}\n\n` +
    `Prompt: ${prompt}`
  );
}

/**
 * Official /imagine-video expansion (trimmed workflow from xai-grok-tools-api).
 * Video starts from an image — no pure text-to-video tool.
 */
export function buildImagineVideoInstruction(prompt, imagePaths = []) {
  const paths = (Array.isArray(imagePaths) ? imagePaths : [imagePaths])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  // image_to_video takes filesystem paths/URLs, not ACP attachments, so
  // reference images must be spelled out as absolute paths in the prompt.
  const referenceBlock =
    paths.length > 0
      ? "## Source reference image(s)\n\n" +
        "Use these absolute paths directly as the `image` input for `image_to_video` " +
        "(or as `images` entries for `reference_to_video`). Do not regenerate them with `image_gen`:\n" +
        paths.map((p) => `- ${p}`).join("\n") +
        "\n\n"
      : "";
  return (
    "# Imagine Video\n\n" +
    "Video starts from an image — there is no text-to-video tool. " +
    "Default to `image_to_video`; use `reference_to_video` only when the user " +
    "explicitly asks for it or a shot genuinely needs multiple reference images.\n\n" +
    referenceBlock +
    "## Default: single clip\n\n" +
    "Unless the user asks for a long video, multiple scenes, or a multi-shot sequence, " +
    "generate **one** video:\n\n" +
    "1. Create a source image with `image_gen` that stages the first frame " +
    "(composition, subject, lighting).\n" +
    "2. Call `image_to_video` with that image and a short prompt describing the motion " +
    "or camera move (1–2 sentences, present tense).\n" +
    "3. After the tool completes, mention the saved file path so the user can find it.\n\n" +
    "## Longer / multi-shot videos\n\n" +
    "Plan shots, generate each source image, animate with `image_to_video`, and assemble with " +
    "FFmpeg stream copy when needed. Prefer 6s clips. Keep resolution/frame-rate consistent.\n\n" +
    `User prompt: ${prompt}`
  );
}

const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff"
};

export function guessImageMimeType(filePath) {
  const ext = path.extname(String(filePath ?? "")).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || "application/octet-stream";
}

/**
 * Build ACP content blocks for `--prompt-json` (array form).
 * Image blocks use the agent-client-protocol shape: { type, mimeType, data }.
 */
export function buildAcpPromptBlocks({ text, imagePaths = [] } = {}) {
  const blocks = [];
  const trimmed = String(text ?? "").trim();
  if (trimmed) {
    blocks.push({ type: "text", text: trimmed });
  }

  for (const imagePath of imagePaths) {
    const resolved = path.resolve(String(imagePath));
    if (!fs.existsSync(resolved)) {
      throw new Error(`Image not found: ${resolved}`);
    }
    const data = fs.readFileSync(resolved).toString("base64");
    blocks.push({
      type: "image",
      mimeType: guessImageMimeType(resolved),
      data
    });
  }

  if (blocks.length === 0) {
    throw new Error("Prompt content is empty (need text and/or images).");
  }
  return blocks;
}

export function buildAcpPromptJson(options = {}) {
  return JSON.stringify(buildAcpPromptBlocks(options));
}

/**
 * Extract likely saved media paths from Grok text output.
 * Media tools save under the session folder and tell the model to cite
 * session-relative paths (`images/1.jpg`, `videos/1.mp4`), so both absolute
 * and those session-relative forms are matched.
 */
export function extractMediaPaths(text) {
  const source = String(text ?? "");
  if (!source) {
    return [];
  }
  const matches = source.match(
    /(?:^|[\s`"'(])((?:(?:\/|[A-Za-z]:\\)[^\s`"'()]+?|(?:images|videos)\/[A-Za-z0-9._-]+)\.(?:png|jpe?g|gif|webp|mp4|webm|mov))(?=$|[\s`"'),.])/gi
  );
  if (!matches) {
    return [];
  }
  const seen = new Set();
  const paths = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/^[\s`"'(]+/, "").replace(/[`"'),.]+$/, "");
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    paths.push(cleaned);
  }
  return paths;
}

/**
 * Locate the Grok session folder for a session id.
 * Sessions live at $GROK_HOME/sessions/<encoded-cwd>/<session-id>/; the cwd
 * encoding is an implementation detail, so scan one level for the id instead.
 */
export function locateGrokSessionDir(sessionId, env = process.env) {
  const id = String(sessionId ?? "").trim();
  if (!id) {
    return null;
  }
  const sessionsRoot = path.join(authHome(env), "sessions");
  let entries;
  try {
    entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(sessionsRoot, entry.name, id);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve extracted media paths to absolute paths where possible.
 * Session-relative paths (`images/1.jpg`) resolve against the session folder
 * and are kept only when the file actually exists; absolute paths pass through.
 */
export function resolveSessionMediaPaths(mediaPaths, sessionId, env = process.env) {
  const list = Array.isArray(mediaPaths) ? mediaPaths : [];
  if (list.length === 0) {
    return [];
  }
  let sessionDir = null;
  let sessionDirResolved = false;
  const seen = new Set();
  const resolved = [];
  for (const mediaPath of list) {
    let absolute = mediaPath;
    const isAbsolute = path.isAbsolute(mediaPath) || /^[A-Za-z]:\\/.test(mediaPath);
    if (!isAbsolute) {
      if (!sessionDirResolved) {
        sessionDir = locateGrokSessionDir(sessionId, env);
        sessionDirResolved = true;
      }
      if (!sessionDir) {
        continue;
      }
      absolute = path.join(sessionDir, mediaPath);
      if (!fs.existsSync(absolute)) {
        continue;
      }
    }
    if (!seen.has(absolute)) {
      seen.add(absolute);
      resolved.push(absolute);
    }
  }
  return resolved;
}

/**
 * Parse headless stdout for either final `json` or NDJSON `streaming-json`.
 * @returns {{ text: string, sessionId: string | null, parsed: object | null, parseError: string | null, events: object[] }}
 */
export function parseHeadlessStdout(rawStdout) {
  const trimmed = String(rawStdout ?? "").trim();
  if (!trimmed) {
    return { text: "", sessionId: null, parsed: null, parseError: null, events: [] };
  }

  // Prefer single JSON object (classic --output-format json, pretty-printed).
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      let text = "";
      if (typeof parsed.text === "string") {
        text = parsed.text;
      } else if (parsed.type === "error" && typeof parsed.message === "string") {
        text = parsed.message;
      }
      return {
        text,
        sessionId: parsed.sessionId ?? parsed.session_id ?? null,
        parsed,
        parseError: null,
        structuredOutput: parsed.structuredOutput ?? null,
        structuredOutputError: parsed.structuredOutputError ?? null,
        events: []
      };
    }
  } catch {
    // Fall through to NDJSON streaming-json.
  }

  const events = [];
  const textChunks = [];
  let sessionId = null;
  let parseError = null;
  let lastObject = null;
  let structuredOutput = null;
  let structuredOutputError = null;

  for (const line of trimmed.split(/\r?\n/)) {
    const row = line.trim();
    if (!row) {
      continue;
    }
    try {
      const event = JSON.parse(row);
      events.push(event);
      lastObject = event;
      if (event?.type === "text" && typeof event.data === "string") {
        textChunks.push(event.data);
      } else if (event?.type === "error" && typeof event.message === "string") {
        parseError = event.message;
      } else if (event?.type === "end") {
        sessionId = event.sessionId ?? event.session_id ?? sessionId;
        structuredOutput = event.structuredOutput ?? structuredOutput;
        structuredOutputError = event.structuredOutputError ?? structuredOutputError;
      }
      if (event?.sessionId || event?.session_id) {
        sessionId = event.sessionId ?? event.session_id ?? sessionId;
      }
    } catch (error) {
      parseError = error.message;
    }
  }

  return {
    text: textChunks.join(""),
    sessionId,
    parsed: lastObject,
    parseError,
    structuredOutput,
    structuredOutputError,
    events
  };
}

/**
 * Run a single headless Grok turn and return structured result.
 *
 * Unlike Codex app-server (JSON-RPC over a long-lived process), Grok headless is one
 * process per turn. Large review prompts are written to a temp file and passed with
 * --prompt-file so we do not blow OS ARG_MAX. Multimodal prompts are ACP content
 * blocks written to a .json prompt file (equivalent to --prompt-json, without argv
 * limits). Live progress uses --output-format streaming-json when a progress
 * reporter is attached (Codex-parity streaming feel without app-server).
 */
export function runHeadlessTurn(options = {}) {
  const {
    prompt = null,
    promptJson = null,
    imagePaths = null,
    cwd = process.cwd(),
    model = null,
    effort = null,
    // Plugin runs are unattended (Codex equivalent: approvalPolicy "never").
    alwaysApprove = true,
    yolo = false,
    tools = null,
    disallowedTools = null,
    resumeSessionId = null,
    jsonSchema = null,
    maxTurns = null,
    noSubagents = false,
    disableWebSearch = false,
    worktree = null,
    worktreeRef = null,
    check = false,
    bestOfN = null,
    extraArgs = [],
    env = process.env,
    onProgress = null,
    timeoutMs = 0,
    promptFileThresholdBytes = PROMPT_FILE_THRESHOLD_BYTES,
    // Auto: streaming when onProgress is set; otherwise final json.
    outputFormat = null
  } = options;

  const imageList = Array.isArray(imagePaths)
    ? imagePaths.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  let resolvedPromptJson = promptJson;
  if (!resolvedPromptJson && imageList.length > 0) {
    resolvedPromptJson = buildAcpPromptJson({
      text: prompt ?? "",
      imagePaths: imageList
    });
  }

  const promptText = resolvedPromptJson ? null : prompt == null ? "" : String(prompt);
  if (!resolvedPromptJson && !String(promptText ?? "").trim()) {
    throw new Error("A prompt is required for this Grok run.");
  }

  const availability = getGrokAvailability(cwd, env);
  if (!availability.available) {
    throw new Error(
      `Grok CLI is not available (${availability.detail}). Install Grok Build and ensure \`grok\` is on PATH, then rerun \`/grok:setup\`.`
    );
  }

  const binary = availability.binary;
  const tempFiles = [];
  const useStreaming =
    outputFormat === "streaming-json" || (outputFormat == null && typeof onProgress === "function");
  const args = ["--output-format", useStreaming ? "streaming-json" : "json", "--no-auto-update"];

  if (resolvedPromptJson) {
    const jsonText =
      typeof resolvedPromptJson === "string" ? resolvedPromptJson : JSON.stringify(resolvedPromptJson);
    // Multimodal / ACP payloads routinely exceed argv limits; always use a temp file.
    // .json extension makes Grok parse content blocks (see HeadlessPrompt::from_file).
    const promptPath = path.join(
      os.tmpdir(),
      `grok-plugin-prompt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    fs.writeFileSync(promptPath, jsonText, "utf8");
    tempFiles.push(promptPath);
    args.push("--prompt-file", promptPath);
  } else if (Buffer.byteLength(promptText, "utf8") >= promptFileThresholdBytes) {
    // Large embedded diffs (reviews) must not go through argv.
    const promptPath = path.join(
      os.tmpdir(),
      `grok-plugin-prompt-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );
    fs.writeFileSync(promptPath, promptText, "utf8");
    tempFiles.push(promptPath);
    args.push("--prompt-file", promptPath);
  } else {
    args.push("-p", promptText);
  }

  if (alwaysApprove || yolo) {
    // Documented flag in `grok --help`; --yolo is a compatible alias in current builds.
    args.push("--always-approve");
  }
  if (model) {
    args.push("-m", String(model));
  }
  if (effort) {
    args.push("--effort", String(effort));
  }
  if (resumeSessionId) {
    args.push("--resume", String(resumeSessionId));
  }
  if (tools) {
    args.push("--tools", Array.isArray(tools) ? tools.join(",") : String(tools));
  }
  if (disallowedTools) {
    args.push(
      "--disallowed-tools",
      Array.isArray(disallowedTools) ? disallowedTools.join(",") : String(disallowedTools)
    );
  }
  if (jsonSchema) {
    const schemaText = typeof jsonSchema === "string" ? jsonSchema : JSON.stringify(jsonSchema);
    // Schema is small; keep inline. Grok accepts the JSON string on --json-schema.
    args.push("--json-schema", schemaText);
  }
  if (maxTurns != null && Number(maxTurns) > 0) {
    args.push("--max-turns", String(maxTurns));
  }
  if (noSubagents) {
    args.push("--no-subagents");
  }
  if (disableWebSearch) {
    args.push("--disable-web-search");
  }
  if (worktree === true) {
    args.push("--worktree");
  } else if (typeof worktree === "string" && worktree.trim()) {
    args.push("--worktree", worktree.trim());
  }
  if (worktreeRef) {
    args.push("--worktree-ref", String(worktreeRef));
  }
  if (check) {
    args.push("--check");
  }
  if (bestOfN != null && Number(bestOfN) > 1) {
    args.push("--best-of-n", String(bestOfN));
  }
  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  onProgress?.({ message: `Starting Grok (${binary}).`, phase: "starting" });

  const cleanupTemp = () => {
    for (const filePath of tempFiles) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  };

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    let stdoutCarry = "";

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        if (!settled) {
          settled = true;
          cleanupTemp();
          reject(new Error(`Grok timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      const textChunk = chunk.toString("utf8");
      stdout += textChunk;
      if (!useStreaming || !onProgress) {
        return;
      }
      stdoutCarry += textChunk;
      const lines = stdoutCarry.split(/\r?\n/);
      stdoutCarry = lines.pop() ?? "";
      for (const line of lines) {
        const row = line.trim();
        if (!row) {
          continue;
        }
        try {
          const event = JSON.parse(row);
          if (event?.type === "thought" && typeof event.data === "string" && event.data.trim()) {
            onProgress({
              message: event.data.slice(0, 200),
              phase: "thinking",
              threadId: event.sessionId ?? null
            });
          } else if (event?.type === "text" && typeof event.data === "string" && event.data.trim()) {
            onProgress({
              message: event.data.slice(0, 200),
              phase: "running",
              threadId: event.sessionId ?? null
            });
          } else if (event?.type === "end") {
            onProgress({
              message: "Grok turn finished.",
              phase: "finalizing",
              threadId: event.sessionId ?? null
            });
          } else if (event?.type === "error" && typeof event.message === "string") {
            onProgress({
              message: event.message.slice(0, 200),
              phase: "running",
              stderrMessage: event.message.slice(0, 200)
            });
          }
        } catch {
          // ignore partial/non-json lines while streaming
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      const line = chunk.toString("utf8").trim();
      if (line) {
        onProgress?.({ message: line.slice(0, 200), phase: "running", stderrMessage: line.slice(0, 200) });
      }
    });

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        cleanupTemp();
        reject(error);
      }
    });

    child.on("close", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      cleanupTemp();
      if (settled) {
        return;
      }
      settled = true;

      onProgress?.({ message: "Grok turn finished.", phase: "finalizing" });

      const trimmedStdout = stdout.trim();
      const parsedOut = parseHeadlessStdout(trimmedStdout);
      const text = parsedOut.text || "";
      const sessionId = parsedOut.sessionId;
      const parsed = parsedOut.parsed;
      const parseError = parsedOut.parseError;
      const mediaPaths = extractMediaPaths(text);

      const status = code === 0 ? 0 : code ?? 1;
      if (parsed?.type === "error") {
        resolve({
          status: status || 1,
          text: text || parsed.message || "Grok returned an error.",
          sessionId,
          rawStdout: trimmedStdout,
          stderr: stderr.trim(),
          signal,
          parsed,
          parseError: parsed.message || parseError,
          structuredOutput: parsedOut.structuredOutput ?? null,
          structuredOutputError: parsedOut.structuredOutputError ?? null,
          mediaPaths,
          events: parsedOut.events
        });
        return;
      }

      resolve({
        status,
        text: text || "",
        sessionId,
        rawStdout: trimmedStdout,
        stderr: stderr.trim(),
        signal,
        parsed,
        parseError,
        structuredOutput: parsedOut.structuredOutput ?? null,
        structuredOutputError: parsedOut.structuredOutputError ?? null,
        mediaPaths,
        events: parsedOut.events
      });
    });
  });
}

/** Synchronous probe used by setup when async is unnecessary. */
export function probeGrokVersion(cwd, env = process.env) {
  const binary = resolveGrokBinary(env);
  return runCommand(binary, ["--version"], { cwd, env });
}

export { VALID_REASONING_EFFORTS };
