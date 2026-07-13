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
      authMethod: "api-key"
    };
  }

  const authPath = path.join(authHome(env), "auth.json");
  if (!fs.existsSync(authPath)) {
    return {
      available: true,
      loggedIn: false,
      detail: "No auth.json and no XAI_API_KEY. Run `grok login`.",
      source: "missing",
      authMethod: null
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
        authMethod: null
      };
    }

    return {
      available: true,
      loggedIn: true,
      detail: "Cached credentials found in ~/.grok/auth.json",
      source: "auth.json",
      authMethod: "session"
    };
  } catch (error) {
    return {
      available: true,
      loggedIn: false,
      detail: `Failed to read auth.json: ${error instanceof Error ? error.message : String(error)}`,
      source: "auth.json",
      authMethod: null
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
 * Run a single headless Grok turn and return structured result.
 */
export function runHeadlessTurn(options = {}) {
  const {
    prompt,
    cwd = process.cwd(),
    model = null,
    effort = null,
    yolo = false,
    tools = null,
    disallowedTools = null,
    resumeSessionId = null,
    jsonSchema = null,
    extraArgs = [],
    env = process.env,
    onProgress = null,
    timeoutMs = 0
  } = options;

  if (!prompt || !String(prompt).trim()) {
    throw new Error("A prompt is required for this Grok run.");
  }

  const availability = getGrokAvailability(cwd, env);
  if (!availability.available) {
    throw new Error(
      `Grok CLI is not available (${availability.detail}). Install Grok Build and ensure \`grok\` is on PATH, then rerun \`/grok:setup\`.`
    );
  }

  const binary = availability.binary;
  const args = ["-p", String(prompt), "--output-format", "json", "--no-auto-update"];

  if (yolo) {
    args.push("--yolo");
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
    args.push("--json-schema", schemaText);
  }
  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  onProgress?.({ message: `Starting Grok (${binary}).`, phase: "starting" });

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

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        if (!settled) {
          settled = true;
          reject(new Error(`Grok timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
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
        reject(error);
      }
    });

    child.on("close", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (settled) {
        return;
      }
      settled = true;

      onProgress?.({ message: "Grok turn finished.", phase: "finalizing" });

      const trimmedStdout = stdout.trim();
      let parsed = null;
      let text = trimmedStdout;
      let sessionId = null;
      let parseError = null;

      if (trimmedStdout) {
        try {
          parsed = JSON.parse(trimmedStdout);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.text === "string") {
              text = parsed.text;
            } else if (parsed.type === "error" && typeof parsed.message === "string") {
              text = parsed.message;
            }
            sessionId = parsed.sessionId ?? parsed.session_id ?? null;
          }
        } catch (error) {
          parseError = error.message;
        }
      }

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
          parseError: parsed.message || parseError
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
        parseError
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
