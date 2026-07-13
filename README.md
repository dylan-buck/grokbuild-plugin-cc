# Grok plugin for Claude Code

Use [Grok Build](https://x.ai/cli) from inside Claude Code for code reviews or to delegate tasks to Grok.

This plugin mirrors the UX of OpenAI’s official [codex-plugin-cc](https://github.com/openai/codex-plugin-cc): slash commands, a thin rescue subagent, background job tracking, and an optional stop-time review gate. The runtime wraps your local `grok` CLI headless mode instead of Codex’s app-server.

Not affiliated with xAI or OpenAI.

## What You Get

- `/grok:review` — read-only code review of your working tree or branch
- `/grok:adversarial-review` — steerable challenge review
- `/grok:rescue`, `/grok:transfer`, `/grok:status`, `/grok:result`, `/grok:cancel` — delegate work, hand off sessions, manage background jobs
- `/grok:setup` — install/auth checks and optional review gate toggle
- `grok:grok-rescue` subagent for proactive handoff from Claude

## Requirements

- **Grok Build CLI** with access (see [x.ai/cli](https://x.ai/cli))
- Signed in via `grok login` **or** `XAI_API_KEY`
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code (local path while developing, or a GitHub repo once published):

```bash
/plugin marketplace add /Users/you/path/to/grok-plugin-cc
# or: /plugin marketplace add your-org/grok-plugin-cc
```

Install the plugin:

```bash
/plugin install grok@grok-plugin-cc
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/grok:setup
```

If Grok is missing, install Grok Build and ensure `grok` is on your `PATH` (or set `GROK_BIN`). If it is installed but not logged in:

```bash
!grok login
```

## Usage

### `/grok:review`

Read-only review of uncommitted changes, or of a branch with `--base <ref>`.

```bash
/grok:review
/grok:review --base main
/grok:review --background
```

The companion embeds the git diff in the prompt and disables write tools so review is deterministic.

### `/grok:adversarial-review`

Same targeting as review, but steerable. Extra text after flags becomes focus:

```bash
/grok:adversarial-review --base main challenge the caching design
```

### `/grok:rescue`

Delegates through the `grok:grok-rescue` subagent.

```bash
/grok:rescue investigate why the tests started failing
/grok:rescue --resume apply the top fix from the last run
/grok:rescue --model grok-build --effort high --background fix the flaky suite
```

Defaults to write-capable Grok (`--write` under the hood). Use a read-only ask if you only want diagnosis without edits.

### `/grok:status` / `/grok:result` / `/grok:cancel`

Background job control for the current repository:

```bash
/grok:status
/grok:result task-abc123
/grok:cancel task-abc123
```

Finished jobs include a Grok session ID when available:

```bash
grok --resume <session-id>
```

### `/grok:transfer`

Best-effort Claude → Grok handoff. Grok does not currently expose a Codex-style session importer, so the plugin writes a handoff markdown package you can open in Grok.

```bash
/grok:transfer
/grok:transfer --source ~/.claude/projects/.../<session>.jsonl
```

### `/grok:setup`

```bash
/grok:setup
/grok:setup --enable-review-gate
/grok:setup --disable-review-gate
```

When the review gate is enabled, a `Stop` hook runs a targeted Grok review of Claude’s last turn and can block stop if issues remain. This can use a lot of quota — enable only when monitoring the session.

## Architecture

```
Claude Code slash commands / agents / hooks
        │
        ▼
plugins/grok/scripts/grok-companion.mjs
  ├── job registry (CLAUDE_PLUGIN_DATA)
  ├── git context for reviews
  └── spawn local `grok -p --output-format json`
```

Unlike Codex’s app-server broker, each job is a headless process. Cancel sends SIGTERM to the process group. Resume uses Grok’s native session IDs.

## Configuration

Grok’s own config still applies:

- User: `~/.grok/config.toml`
- Auth: `~/.grok/auth.json` or `XAI_API_KEY`
- Override binary: `GROK_BIN=/path/to/grok`

Plugin job state lives under Claude’s plugin data directory (or a temp fallback).

## Development

```bash
npm test
```

Tests use a fake `grok` binary (`tests/fake-grok.mjs`) so CI does not need real Grok credentials.

Manual smoke against a real install:

```bash
node plugins/grok/scripts/grok-companion.mjs setup --json
node plugins/grok/scripts/grok-companion.mjs review --json
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
