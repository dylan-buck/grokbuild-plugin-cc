#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { buildHandoffMarkdown, resolveClaudeSessionPath } from "./lib/claude-session-transfer.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import {
  buildImagineEditInstruction,
  buildImagineInstruction,
  buildImagineVideoInstruction,
  getGrokAuthStatus,
  getGrokAvailability,
  IMAGINE_ALLOWED_TOOLS,
  normalizeReasoningEffort,
  parseStructuredOutput,
  probeGrokAuthLive,
  readOutputSchema,
  READ_ONLY_DISALLOWED_TOOLS,
  REVIEW_DISALLOWED_TOOLS,
  runHeadlessTurn
} from "./lib/grok.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
  renderTransferResult
} from "./lib/render.mjs";
import { generateJobId, getConfig, listJobs, setConfig, upsertJob, writeJobFile } from "./lib/state.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/grok-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--skip-live-auth] [--json]",
      "  node scripts/grok-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>]",
      "  node scripts/grok-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [focus text]",
      "  node scripts/grok-companion.mjs task [--background] [--write|--read] [--resume-last|--resume|--fresh] [--model <model>] [--effort <none|minimal|low|medium|high|xhigh|max>] [--image <path>]... [--worktree] [--worktree-name <name>] [--worktree-ref <ref>] [--check] [--best-of-n <n>] [prompt]",
      "  node scripts/grok-companion.mjs imagine [--background] [--edit <image>]... [--model <model>] [--aspect <ratio>] [description]",
      "  node scripts/grok-companion.mjs imagine-video [--background] [--model <model>] [description]",
      "  node scripts/grok-companion.mjs transfer [--source <claude-jsonl>] [--json]",
      "  node scripts/grok-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/grok-companion.mjs result [job-id] [--json]",
      "  node scripts/grok-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function ensureGrokAvailable(cwd) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      `Grok CLI is not available (${availability.detail}). Install Grok Build, ensure \`grok\` is on PATH (or set GROK_BIN), then rerun \`/grok:setup\`.`
    );
  }
}

async function buildSetupReport(cwd, actionsTaken = [], options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const grokStatus = getGrokAvailability(cwd);
  let authStatus = getGrokAuthStatus(cwd);
  const config = getConfig(workspaceRoot);
  const skipLiveAuth = Boolean(options.skipLiveAuth);

  if (grokStatus.available && authStatus.loggedIn && !skipLiveAuth) {
    const live = await probeGrokAuthLive(cwd, { timeoutMs: 20_000 });
    authStatus = {
      ...authStatus,
      liveVerified: live.liveVerified,
      detail: live.liveVerified
        ? `${authStatus.detail}; live probe OK`
        : `${authStatus.detail}; live probe failed: ${live.detail}`,
      loggedIn: live.liveVerified ? true : authStatus.loggedIn
    };
    // Treat failed live probe as not ready even if cache looked present.
    if (!live.liveVerified) {
      authStatus.loggedIn = false;
    }
  } else if (skipLiveAuth) {
    authStatus = {
      ...authStatus,
      liveVerified: null,
      detail: `${authStatus.detail}; live probe skipped`
    };
  }

  const nextSteps = [];
  if (!grokStatus.available) {
    nextSteps.push("Install Grok Build from https://x.ai/cli and ensure `grok` is on your PATH.");
    nextSteps.push("Or set GROK_BIN to the absolute path of the grok binary.");
  }
  if (grokStatus.available && !authStatus.loggedIn) {
    nextSteps.push("Run `!grok login` (or `!grok login --device-auth` on headless machines).");
    nextSteps.push("Alternatively set XAI_API_KEY from https://console.x.ai.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/grok:setup --enable-review-gate` to require a fresh review before stop.");
  }

  const ready =
    nodeStatus.available &&
    grokStatus.available &&
    authStatus.loggedIn &&
    (skipLiveAuth || authStatus.liveVerified !== false);

  return {
    ready,
    node: nodeStatus,
    grok: grokStatus,
    auth: authStatus,
    sessionRuntime: {
      mode: "headless",
      label: "headless process",
      detail: "Each Grok job runs as a local headless CLI process."
    },
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate", "skip-live-auth"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = await buildSetupReport(cwd, actionsTaken, {
    skipLiveAuth: Boolean(options["skip-live-auth"])
  });
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function buildReviewPrompt(context, options = {}) {
  const reviewName = options.reviewName ?? "Review";
  const focusText = options.focusText?.trim() || "No extra focus provided.";
  if (reviewName === "Adversarial Review") {
    const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
    return interpolateTemplate(template, {
      REVIEW_KIND: "Adversarial Review",
      TARGET_LABEL: context.target.label,
      USER_FOCUS: focusText,
      REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
      REVIEW_INPUT: context.content
    });
  }

  const template = loadPromptTemplate(ROOT_DIR, "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText,
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function findLatestResumableTaskJob(jobs) {
  return (
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.threadId &&
        job.status !== "queued" &&
        job.status !== "running"
    ) ?? null
  );
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function resolveLatestTrackedTaskSession(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
  const activeTask = visibleJobs.find((job) => job.jobClass === "task" && (job.status === "queued" || job.status === "running"));
  if (activeTask) {
    throw new Error(`Task ${activeTask.id} is still running. Use /grok:status before continuing it.`);
  }

  const trackedTask = findLatestResumableTaskJob(visibleJobs);
  if (trackedTask?.threadId) {
    return trackedTask.threadId;
  }

  // Prefer an explicit message when a finished task exists but lost its session id.
  const finishedTaskWithoutSession = visibleJobs.find(
    (job) => job.jobClass === "task" && job.status !== "queued" && job.status !== "running" && !job.threadId
  );
  if (finishedTaskWithoutSession) {
    throw new Error(
      `Previous task ${finishedTaskWithoutSession.id} finished without a stored Grok session ID, so it cannot be resumed. Start a fresh task (omit --resume) or re-run the work.`
    );
  }
  return null;
}

async function executeReviewRun(request) {
  ensureGrokAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";

  const context = collectReviewContext(request.cwd, target);
  if (context.fileCount === 0 && target.mode === "working-tree") {
    throw new Error("Nothing to review in the working tree. Make changes or pass --base <ref> for a branch review.");
  }

  const prompt = buildReviewPrompt(context, { reviewName, focusText });
  const schema = readOutputSchema(REVIEW_SCHEMA);

  request.onProgress?.({ message: `Collecting ${context.target.label} (${context.fileCount} file(s)).`, phase: "starting" });

  const result = await runHeadlessTurn({
    prompt,
    cwd: context.repoRoot,
    model: request.model,
    alwaysApprove: true,
    // Embedded-diff review: block tools/subagents/web so Grok answers from the prompt only.
    // Large diffs automatically use --prompt-file (see runHeadlessTurn threshold).
    // Do not use max-turns=1 — Grok can still exit non-zero with "max turns reached" after a
    // schema-constrained turn even when the JSON body is usable.
    disallowedTools: REVIEW_DISALLOWED_TOOLS,
    jsonSchema: schema,
    noSubagents: true,
    disableWebSearch: true,
    onProgress: request.onProgress
  });

  const parsed = parseStructuredOutput(result.text, {
    status: result.status,
    failureMessage: result.parseError || result.stderr || "Grok review failed."
  });

  const payload = {
    review: reviewName,
    target,
    threadId: result.sessionId,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    grok: {
      status: result.status,
      stderr: result.stderr,
      stdout: result.text
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };

  const rendered = renderReviewResult(parsed, {
    reviewLabel: reviewName,
    targetLabel: context.target.label
  });

  // Prefer success when structured review JSON parsed cleanly, even if Grok exited non-zero
  // (e.g. soft runtime warnings after a usable JSON body).
  const structuredOk = Boolean(parsed.parsed && !parsed.parseError);
  const exitStatus = structuredOk ? 0 : result.status === 0 && !result.text ? 1 : result.status;

  return {
    exitStatus,
    threadId: result.sessionId,
    turnId: null,
    payload,
    rendered,
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(result.text, `${reviewName} finished.`),
    jobTitle: `Grok ${reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

function normalizeImagePaths(cwd, imagePaths) {
  if (!imagePaths) {
    return [];
  }
  const list = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  return list
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .map((value) => path.resolve(cwd, value));
}

function appendAspectHint(prompt, aspect) {
  const ratio = String(aspect ?? "").trim();
  if (!ratio) {
    return prompt;
  }
  return `${prompt}\n\nPreferred aspect_ratio for image_gen: ${ratio}`;
}

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureGrokAvailable(request.cwd);

  const taskMetadata = buildTaskRunMetadata({
    prompt: request.prompt,
    resumeLast: request.resumeLast,
    kind: request.kind
  });

  let resumeSessionId = null;
  if (request.resumeLast) {
    resumeSessionId = await resolveLatestTrackedTaskSession(workspaceRoot, {
      excludeJobId: request.jobId
    });
    if (!resumeSessionId) {
      throw new Error(
        "No previous Grok task session was found for this repository. Run a fresh `/grok:rescue` without --resume, or complete a task that returns a session ID first."
      );
    }
  }

  if (!request.prompt && !resumeSessionId) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const prompt = request.prompt?.trim() || (resumeSessionId ? DEFAULT_CONTINUE_PROMPT : "");
  const write = Boolean(request.write);
  const imagePaths = normalizeImagePaths(request.cwd, request.imagePaths);
  const tools = request.tools ?? null;
  const disallowedTools =
    request.disallowedTools !== undefined
      ? request.disallowedTools
      : write
        ? null
        : READ_ONLY_DISALLOWED_TOOLS;

  request.onProgress?.({
    message: resumeSessionId ? `Resuming Grok session ${resumeSessionId}.` : "Starting Grok task.",
    phase: "starting",
    threadId: resumeSessionId
  });

  const result = await runHeadlessTurn({
    prompt,
    imagePaths: imagePaths.length > 0 ? imagePaths : null,
    cwd: workspaceRoot,
    model: request.model,
    effort: request.effort,
    // Always unattended (Codex approvalPolicy "never"). Read-only still needs tool auto-approval
    // so diagnosis tasks do not hang waiting for a TTY permission prompt.
    alwaysApprove: true,
    // Read-only tasks still need tools for investigation; block edits only. Media/Imagine tools remain available.
    tools,
    disallowedTools,
    resumeSessionId,
    worktree: request.worktree ?? null,
    worktreeRef: request.worktreeRef ?? null,
    check: Boolean(request.check),
    bestOfN: request.bestOfN ?? null,
    onProgress: request.onProgress
  });

  const rawOutput = typeof result.text === "string" ? result.text : "";
  const failureMessage = result.status !== 0 ? result.stderr || result.parseError || "Grok task failed." : "";
  const mediaPaths = Array.isArray(result.mediaPaths) ? result.mediaPaths : [];
  const rendered = renderTaskResult({
    rawOutput,
    failureMessage,
    mediaPaths
  });

  const payload = {
    status: result.status,
    threadId: result.sessionId,
    rawOutput,
    resumeSessionId,
    mediaPaths
  };

  return {
    exitStatus: result.status,
    threadId: result.sessionId,
    turnId: null,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task",
    write
  };
}

async function executeImagineRun(request) {
  const description = String(request.prompt ?? "").trim();
  if (!description) {
    throw new Error("Provide an image description for /grok:imagine.");
  }

  const editPaths = normalizeImagePaths(request.cwd, request.editPaths);
  let prompt =
    editPaths.length > 0
      ? buildImagineEditInstruction(description, editPaths)
      : buildImagineInstruction(description);
  prompt = appendAspectHint(prompt, request.aspect);

  return executeTaskRun({
    ...request,
    prompt,
    write: false,
    resumeLast: false,
    tools: IMAGINE_ALLOWED_TOOLS,
    disallowedTools: null,
    kind: "imagine",
    // Reference paths are already embedded in the edit instruction; do not also base64-attach.
    imagePaths: null
  });
}

async function executeImagineVideoRun(request) {
  const description = String(request.prompt ?? "").trim();
  if (!description) {
    throw new Error("Provide a video description for /grok:imagine-video.");
  }

  return executeTaskRun({
    ...request,
    prompt: buildImagineVideoInstruction(description),
    write: true, // assembly may need shell/ffmpeg + project file writes
    resumeLast: false,
    tools: null,
    disallowedTools: null,
    kind: "imagine-video",
    imagePaths: normalizeImagePaths(request.cwd, request.imagePaths)
  });
}

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Grok Review" : `Grok ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false, kind = null }) {
  if (!resumeLast && String(prompt ?? "").includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: "Grok Stop Gate Review",
      summary: "Stop-gate review of previous Claude turn"
    };
  }

  if (kind === "imagine") {
    return {
      title: "Grok Imagine",
      summary: shorten(prompt || "Generate image")
    };
  }
  if (kind === "imagine-video") {
    return {
      title: "Grok Imagine Video",
      summary: shorten(prompt || "Generate video")
    };
  }

  const title = resumeLast ? "Grok Resume" : "Grok Task";
  const fallbackSummary = resumeLast ? DEFAULT_CONTINUE_PROMPT : "Task";
  return {
    title,
    summary: shorten(prompt || fallbackSummary)
  };
}

function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /grok:status ${payload.jobId} for progress.\n`;
}

function getJobKindLabel(kind, jobClass) {
  if (kind === "adversarial-review") {
    return "adversarial-review";
  }
  if (kind === "imagine") {
    return "imagine";
  }
  if (kind === "imagine-video") {
    return "imagine-video";
  }
  return jobClass === "review" ? "review" : "rescue";
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind, jobClass),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

function buildTaskJob(workspaceRoot, taskMetadata, write) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write
  });
}

function buildTaskRequest({
  cwd,
  model,
  effort,
  prompt,
  write,
  resumeLast,
  jobId,
  worktree = null,
  worktreeRef = null,
  check = false,
  bestOfN = null,
  imagePaths = null,
  tools = null,
  disallowedTools = undefined,
  kind = null,
  editPaths = null,
  aspect = null
}) {
  return {
    cwd,
    model,
    effort,
    prompt,
    write,
    resumeLast,
    jobId,
    worktree,
    worktreeRef,
    check,
    bestOfN,
    imagePaths,
    tools,
    disallowedTools,
    kind,
    editPaths,
    aspect
  };
}

function parseOptionalWorktree(options) {
  if (typeof options["worktree-name"] === "string" && options["worktree-name"].trim()) {
    return options["worktree-name"].trim();
  }
  if (options.worktree === true) {
    return true;
  }
  return null;
}

function parseBestOfN(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid --best-of-n value "${value}". Use a positive integer.`);
  }
  return Math.floor(n);
}

function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }

  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

function requireTaskRequest(prompt, resumeLast) {
  if (!prompt && !resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

function spawnDetachedWorker(cwd, jobId, workerCommand) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "grok-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, workerCommand, "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

function enqueueBackgroundJob(cwd, job, request, workerCommand) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedWorker(cwd, job.id, workerCommand);
  const workerPid = child.pid ?? null;
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: workerPid,
    workerPid,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope
  });

  if (config.validateRequest) {
    config.validateRequest(target, focusText);
  }

  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });

  const request = {
    cwd,
    base: options.base,
    scope: options.scope,
    model: options.model,
    focusText,
    reviewName: config.reviewName,
    jobId: job.id
  };

  if (options.background) {
    ensureGrokAvailable(cwd);
    const { payload } = enqueueBackgroundJob(cwd, job, request, "review-worker");
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        ...request,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  // Focus text is allowed: Grok reviews are prompt-based (unlike Codex native reviewer).
  // Use adversarial-review when the user wants a deliberately skeptical/challenge stance.
  return handleReviewCommand(argv, {
    reviewName: "Review"
  });
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "effort", "cwd", "prompt-file", "worktree-ref", "worktree-name", "best-of-n"],
    multiValueOptions: ["image"],
    booleanOptions: ["json", "write", "read", "resume-last", "resume", "fresh", "background", "check", "worktree"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = options.model ?? null;
  const effort = normalizeReasoningEffort(options.effort);
  const prompt = readTaskPrompt(cwd, options, positionals);
  const imagePaths = options.image ?? null;

  const resumeLast = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resumeLast && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }
  if (options.write && options.read) {
    throw new Error("Choose either --write or --read.");
  }
  // Codex companion uses explicit --write. The rescue agent adds --write by default.
  // --read is a Grok-plugin convenience for diagnosis-only runs.
  const taskWrite = options.read ? false : Boolean(options.write);

  const worktree = parseOptionalWorktree(options);
  const worktreeRef = options["worktree-ref"] ?? null;
  const check = Boolean(options.check);
  const bestOfN = parseBestOfN(options["best-of-n"]);

  const taskMetadata = buildTaskRunMetadata({
    prompt,
    resumeLast
  });

  if (options.background) {
    ensureGrokAvailable(cwd);
    requireTaskRequest(prompt, resumeLast);

    const job = buildTaskJob(workspaceRoot, taskMetadata, taskWrite);
    const request = buildTaskRequest({
      cwd,
      model,
      effort,
      prompt,
      write: taskWrite,
      resumeLast,
      jobId: job.id,
      worktree,
      worktreeRef,
      check,
      bestOfN,
      imagePaths
    });
    const { payload } = enqueueBackgroundJob(cwd, job, request, "task-worker");
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = buildTaskJob(workspaceRoot, taskMetadata, taskWrite);
  await runForegroundCommand(
    job,
    (progress) =>
      executeTaskRun({
        cwd,
        model,
        effort,
        prompt,
        write: taskWrite,
        resumeLast,
        jobId: job.id,
        worktree,
        worktreeRef,
        check,
        bestOfN,
        imagePaths,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleImagine(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "aspect"],
    multiValueOptions: ["edit"],
    booleanOptions: ["json", "background"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const prompt = positionals.join(" ").trim() || readStdinIfPiped();
  if (!prompt) {
    throw new Error("Provide an image description, e.g. /grok:imagine a golden sunset over the ocean");
  }

  const taskMetadata = buildTaskRunMetadata({ prompt, kind: "imagine" });
  const request = buildTaskRequest({
    cwd,
    model: options.model ?? null,
    prompt,
    write: false,
    resumeLast: false,
    jobId: null,
    editPaths: options.edit ?? null,
    aspect: options.aspect ?? null,
    kind: "imagine",
    tools: IMAGINE_ALLOWED_TOOLS,
    disallowedTools: null
  });

  if (options.background) {
    ensureGrokAvailable(cwd);
    const job = createCompanionJob({
      prefix: "imagine",
      kind: "imagine",
      title: taskMetadata.title,
      workspaceRoot,
      jobClass: "task",
      summary: taskMetadata.summary,
      write: false
    });
    request.jobId = job.id;
    const { payload } = enqueueBackgroundJob(cwd, job, request, "imagine-worker");
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = createCompanionJob({
    prefix: "imagine",
    kind: "imagine",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write: false
  });
  request.jobId = job.id;
  await runForegroundCommand(
    job,
    (progress) =>
      executeImagineRun({
        ...request,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleImagineVideo(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd"],
    multiValueOptions: ["image"],
    booleanOptions: ["json", "background"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const prompt = positionals.join(" ").trim() || readStdinIfPiped();
  if (!prompt) {
    throw new Error("Provide a video description, e.g. /grok:imagine-video a cat playing piano in a jazz club");
  }

  const taskMetadata = buildTaskRunMetadata({ prompt, kind: "imagine-video" });
  const request = buildTaskRequest({
    cwd,
    model: options.model ?? null,
    prompt,
    write: true,
    resumeLast: false,
    jobId: null,
    imagePaths: options.image ?? null,
    kind: "imagine-video"
  });

  if (options.background) {
    ensureGrokAvailable(cwd);
    const job = createCompanionJob({
      prefix: "imgvid",
      kind: "imagine-video",
      title: taskMetadata.title,
      workspaceRoot,
      jobClass: "task",
      summary: taskMetadata.summary,
      write: true
    });
    request.jobId = job.id;
    const { payload } = enqueueBackgroundJob(cwd, job, request, "imagine-video-worker");
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = createCompanionJob({
    prefix: "imgvid",
    kind: "imagine-video",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write: true
  });
  request.jobId = job.id;
  await runForegroundCommand(
    job,
    (progress) =>
      executeImagineVideoRun({
        ...request,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function tryGrokImport(sourcePath, cwd, options = {}) {
  const availability = getGrokAvailability(cwd);
  if (!availability.available) {
    return { attempted: false, imported: false, detail: availability.detail, sessionId: null };
  }

  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const child = spawn(availability.binary, ["import", "--json", sourcePath], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        terminateProcessTree(child.pid ?? Number.NaN);
      } catch {
        // ignore
      }
      finish({
        attempted: true,
        imported: false,
        detail: `import timed out after ${timeoutMs}ms`,
        sessionId: null,
        raw: null
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let last = null;
      for (const line of lines) {
        try {
          last = JSON.parse(line);
        } catch {
          // ignore non-JSON lines
        }
      }
      const outcome = last?.outcome ?? null;
      // Only treat explicit success outcomes as imported. A UUID-looking sessionId alone
      // is not enough (Grok may echo the source path or skip with an error).
      const imported =
        code === 0 &&
        outcome !== "skipped" &&
        (outcome === "imported" || outcome === "ok" || outcome === "created");
      finish({
        attempted: true,
        imported,
        detail: last?.error || stderr.trim() || (imported ? "imported" : `import exit ${code}${outcome ? ` (${outcome})` : ""}`),
        sessionId:
          imported && typeof last?.sessionId === "string" && !last.sessionId.endsWith(".jsonl")
            ? last.sessionId
            : null,
        raw: last
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        attempted: true,
        imported: false,
        detail: error.message,
        sessionId: null,
        raw: null
      });
    });
  });
}

async function handleTransfer(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "source"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sourcePath = resolveClaudeSessionPath(cwd, { source: options.source });
  const handoffBody = buildHandoffMarkdown(sourcePath);
  const handoffDir = path.join(workspaceRoot, ".grok-plugin-handoffs");
  fs.mkdirSync(handoffDir, { recursive: true });
  const sessionId = path.basename(sourcePath, ".jsonl");
  const handoffPath = path.join(handoffDir, `claude-handoff-${sessionId}-${Date.now()}.md`);
  fs.writeFileSync(handoffPath, handoffBody, "utf8");

  // Prefer native `grok import` when the CLI accepts the Claude jsonl.
  const importResult = await tryGrokImport(sourcePath, workspaceRoot);

  const payload = {
    sourcePath,
    handoffPath,
    sessionId,
    mode: importResult.imported ? "imported" : "best-effort",
    import: importResult,
    resumeCommand: importResult.sessionId ? `grok --resume ${importResult.sessionId}` : null
  };
  outputCommandResult(payload, renderTransferResult(payload), options.json);
}

async function handleWorker(argv, runner) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its request payload.`);
  }

  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    },
    {
      logFile: storedJob.logFile ?? null
    }
  );
  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    },
    () =>
      runner({
        ...request,
        onProgress: progress
      }),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = filterJobsForCurrentClaudeSession(sortJobsNewestFirst(listJobs(workspaceRoot)));
  const candidate = findLatestResumableTaskJob(jobs);

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            threadId: candidate.threadId,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};
  const pids = [...new Set([job.pid, job.workerPid, existing.pid, existing.workerPid].filter((v) => Number.isFinite(Number(v))).map(Number))];

  const killResults = [];
  for (const pid of pids) {
    try {
      killResults.push(terminateProcessTree(pid));
    } catch (error) {
      killResults.push({
        attempted: true,
        delivered: false,
        method: "error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (pids.length === 0) {
    // Still mark cancelled; process may already be gone (reconcile will agree).
    killResults.push({ attempted: false, delivered: false, method: null });
  }

  appendLogLine(job.logFile, `Cancelled by user (pids: ${pids.join(", ") || "none"}).`);

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    workerPid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt,
    killResults
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    workerPid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title,
    pids,
    killResults
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "imagine":
      await handleImagine(argv);
      break;
    case "imagine-video":
      await handleImagineVideo(argv);
      break;
    case "transfer":
      await handleTransfer(argv);
      break;
    case "task-worker":
      await handleWorker(argv, executeTaskRun);
      break;
    case "imagine-worker":
      await handleWorker(argv, executeImagineRun);
      break;
    case "imagine-video-worker":
      await handleWorker(argv, executeImagineVideoRun);
      break;
    case "review-worker":
      await handleWorker(argv, executeReviewRun);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
