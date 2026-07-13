#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { getGrokAvailability } from "./lib/grok.mjs";
import { getConfig, listJobs } from "./lib/state.mjs";
import { sortJobsNewestFirst } from "./lib/job-control.mjs";
import { isStopGateJob, runStopGateReview, STOP_REVIEW_TASK_MARKER } from "./lib/stop-gate.mjs";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (!message) {
    return;
  }
  process.stderr.write(`${message}\n`);
}

function filterJobsForCurrentSession(jobs, input = {}) {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || null;
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function buildSetupNote(cwd) {
  const availability = getGrokAvailability(cwd);
  if (availability.available) {
    return null;
  }
  const detail = availability.detail ? ` ${availability.detail}.` : "";
  return `Grok is not set up for the review gate.${detail} Run /grok:setup.`;
}

async function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), input));
  const runningJob = jobs.find((job) => job.status === "queued" || job.status === "running");
  const runningTaskNote = runningJob
    ? `Grok task ${runningJob.id} is still running. Check /grok:status and use /grok:cancel ${runningJob.id} if you want to stop it before ending the session.`
    : null;

  const latestFinished = jobs.find((job) => job.status !== "queued" && job.status !== "running");
  if (isStopGateJob(latestFinished)) {
    logNote(runningTaskNote);
    return;
  }

  if (!config.stopReviewGate) {
    logNote(runningTaskNote);
    return;
  }

  const setupNote = buildSetupNote(cwd);
  if (setupNote) {
    logNote(setupNote);
    logNote(runningTaskNote);
    return;
  }

  const last = String(input.last_assistant_message ?? "");
  if (last.includes(STOP_REVIEW_TASK_MARKER)) {
    return;
  }

  const review = await runStopGateReview(workspaceRoot, input);
  if (!review.ok) {
    emitDecision({
      decision: "block",
      reason: runningTaskNote ? `${runningTaskNote} ${review.reason}` : review.reason
    });
    return;
  }

  logNote(runningTaskNote);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
