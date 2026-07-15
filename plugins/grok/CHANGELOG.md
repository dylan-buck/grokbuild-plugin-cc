# Changelog

## 1.1.2

- `/grok:setup` now offers to run the official installer (`curl -fsSL https://x.ai/cli/install.sh | bash`, PowerShell variant on Windows) when the Grok CLI is missing, mirroring the Codex plugin's guided install.
- `--effort` accepts model-specific effort ids (e.g. `deep`) in addition to the canonical `none`–`max` set; the Grok CLI validates them against the model catalog.
- Dropped the phantom `~/.local/bin/grok` binary fallback — the official installer only ever uses `~/.grok/bin/grok` (use `PATH` or `GROK_BIN` for custom locations).

## 1.1.1

Correctness pass against the actual open-source [Grok Build](https://github.com/xai-org/grok-build) CLI (commit `c1b5909`):

- **Transfer**: removed the speculative `grok import` attempt — the CLI has no `import` subcommand (`/import-claude` in the TUI imports settings, not sessions). Transfer is a handoff package, as documented.
- **Structured output**: `--json-schema` results arrive in the CLI's `structuredOutput` field; reviews and the stop gate now prefer it over re-parsing the final text.
- **Tool registry**: added the OpenCode-derived `write` (create-file) tool and the real subagent tool id `task`. Read-only rescue now blocks `write` alongside `search_replace`; the review denylist blocks `write`, `task`, and `todo_write`.
- **Imagine Video**: `--image` references are embedded as absolute paths in the instruction (the `image_to_video` tool consumes filesystem paths, not prompt attachments) and validated to exist; `--edit` sources on `/grok:imagine` are validated too.
- **Media paths**: session-relative citations (`images/1.jpg`) now resolve to absolute paths via the Grok session folder (`$GROK_HOME/sessions/…/<session-id>/`) when the file exists.
- `task` / `imagine` / `imagine-video` accept and ignore a stray Claude-side `--wait` instead of leaking it into the prompt.

## 1.1.0

Parity pass against the Codex Claude Code plugin surface, grounded in open-source [Grok Build](https://github.com/xai-org/grok-build):

- **`/grok:imagine`** — official `image_gen` instruction (same expansion as Grok TUI `/imagine`); optional `--edit <image>` for `image_edit`, `--aspect`, background jobs
- **`/grok:imagine-video`** — official `image_to_video` workflow instruction (same expansion as Grok TUI `/imagine-video`)
- **Multimodal rescue** — repeatable `--image <path>` on `task` / `/grok:rescue` attaches ACP content blocks via `--prompt-json` / `.json` prompt files
- **Streaming progress** — headless runs with a progress reporter use `--output-format streaming-json` (thought/text/end events) for live job updates closer to Codex app-server progress
- **Tool registry** — `GROK_TOOL_IDS` includes media tools; reviews denylist Imagine tools; read-only rescue keeps them available
- Media path extraction + result rendering for generated assets
- Skills/agents updated for Imagine routing and image attachments

## 1.0.1

- `/grok:review` now accepts optional focus text (Grok reviews are prompt-based; no need to force adversarial-review for ordinary focus).

## 1.0.0

First production release of the Grok Build plugin for Claude Code.

### Features

- `/grok:setup` with binary + auth checks, optional **live auth probe**, review-gate toggle
- `/grok:review` and `/grok:adversarial-review` (embedded git context, structured findings)
- `/grok:rescue` + `grok:grok-rescue` subagent (write by default, `--read`, resume/fresh)
- `/grok:status`, `/grok:result`, `/grok:cancel` background job registry
- `/grok:transfer` handoff package + best-effort `grok import`
- Optional stop-time review gate (structured dirty-tree review)
- Grok-native task flags: `--worktree`, `--worktree-name`, `--worktree-ref`, `--check`, `--best-of-n`

### Hardening

- Large prompts use `--prompt-file` (avoids OS argv limits)
- Unattended runs use `--always-approve` (Codex-equivalent never-ask policy)
- Dead worker PIDs reconciled on status (zombie jobs marked failed)
- SessionEnd kills running jobs but **retains** finished results
- Cancel tries process-group then direct PID; always records cancelled state
- Transfer never claims import success on skip/empty sessions

### Requirements

- Grok Build CLI + login or `XAI_API_KEY`
- Node.js 18.18+

Not affiliated with xAI or OpenAI. Architecture inspired by [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).
