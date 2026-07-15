# Grok Build plugin for Claude Code

Use Grok Build from inside Claude Code for code reviews or to delegate tasks to Grok.

This plugin is for Claude Code users who want an easy way to start using Grok Build from the workflow
they already have.

## What You Get

- `/grok:review` for a normal read-only Grok review
- `/grok:adversarial-review` for a steerable challenge review
- `/grok:rescue`, `/grok:transfer`, `/grok:status`, `/grok:result`, and `/grok:cancel` to delegate work, hand off sessions, and manage background jobs
- `/grok:imagine` and `/grok:imagine-video` for Grok Build Imagine (image_gen / image_to_video)
- Multimodal rescue via `--image <path>` (ACP content blocks / vision)

Command surface mirrors the [OpenAI Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc), adapted to Grok Build's headless CLI (open-sourced at [xai-org/grok-build](https://github.com/xai-org/grok-build)).

## Requirements

- **Grok Build access** (xAI account / Grok subscription or `XAI_API_KEY`).
  - Usage will contribute to your Grok usage limits. [Learn more](https://x.ai/cli).
  - Imagine image/video tools may require SuperGrok (or equivalent plan access).
- **Node.js 18.18 or later**
- **Grok Build CLI** on `PATH` (or `GROK_BIN`) — install from [x.ai/cli](https://x.ai/cli)

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add dylan-buck/grokbuild-plugin-cc
```

Install the plugin:

```bash
/plugin install grok@grokbuild
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/grok:setup
```

`/grok:setup` will tell you whether Grok is ready. If Grok is missing, install [Grok Build](https://x.ai/cli) and ensure `grok` is on your `PATH` (or set `GROK_BIN`).

If Grok is installed but not logged in yet, run:

```bash
!grok login
```

After install, you should see:

- the slash commands listed below
- the `grok:grok-rescue` subagent in `/agents`

One simple first run is:

```bash
/grok:review --background
/grok:status
/grok:result
```

## Usage

### `/grok:review`

Runs a normal Grok review on your current work. The companion embeds your git diff and runs a structured, read-only review through the local Grok CLI.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. Optional free text after flags is treated as review focus. Use [`/grok:adversarial-review`](#grokadversarial-review) when you want a deliberately skeptical challenge of the design, not just a normal review.

Examples:

```bash
/grok:review
/grok:review --base main
/grok:review --background
/grok:review focus on tone conversation accuracy and App Store readiness
```

This command is read-only and will not perform any changes. When run in the background you can use [`/grok:status`](#grokstatus) to check on the progress and [`/grok:cancel`](#grokcancel) to cancel the ongoing task.

### `/grok:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/grok:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/grok:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/grok:adversarial-review
/grok:adversarial-review --base main challenge whether this was the right caching and retry design
/grok:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/grok:rescue`

Hands a task to Grok through the `grok:grok-rescue` subagent.

Use it when you want Grok to:

- investigate a bug
- try a fix
- continue a previous Grok task
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/grok:rescue investigate why the tests started failing
/grok:rescue fix the failing test with the smallest safe patch
/grok:rescue --resume apply the top fix from the last run
/grok:rescue --model grok-4.5 --effort high investigate the flaky integration test
/grok:rescue --read why is the auth middleware rejecting valid tokens?
/grok:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Grok:

```text
Ask Grok to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model` or `--effort`, Grok chooses its own defaults.
- follow-up rescue requests can continue the latest Grok task in the repo
- rescue defaults to write-capable work; use `--read` for diagnosis-only
- Grok-native extras: `--worktree`, `--worktree-name`, `--worktree-ref`, `--check`, `--best-of-n`
- attach images for vision-aware tasks with one or more `--image <path>` flags
- write-capable and read-only rescue runs keep Imagine tools (`image_gen`, `image_edit`, …) available; use `/grok:imagine` for dedicated generation

### `/grok:imagine`

Generate an image with Grok Build Imagine (`image_gen`), using the same official instruction as the Grok TUI `/imagine` command.

Examples:

```bash
/grok:imagine a golden sunset over a calm ocean
/grok:imagine --aspect 16:9 hero banner of a rocket launch
/grok:imagine --edit ./reference.png make it watercolor
/grok:imagine --background neon cyberpunk city skyline
```

Use `--edit <path>` (repeatable) to run `image_edit` against source images instead of a pure text-to-image generation.

> [!NOTE]
> Image generation may require SuperGrok. If your plan does not include Imagine, Grok returns an upgrade message.

### `/grok:imagine-video`

Generate a short video. Grok stages a first frame with `image_gen` (or uses `--image` references) and animates it with `image_to_video`, matching the Grok TUI `/imagine-video` workflow.

Examples:

```bash
/grok:imagine-video a cat playing piano in a jazz club
/grok:imagine-video --image ./frame.png gentle camera push-in
/grok:imagine-video --background neon motorcycle chase through rain
```

### `/grok:transfer`

Creates a best-effort handoff from the current Claude Code session so you can continue in Grok.

It writes a handoff markdown package and attempts `grok import` when the local Grok CLI accepts the Claude transcript. When import is skipped or unsupported, use the handoff file with `grok --prompt-file` or paste it into the Grok TUI.

Examples:

```bash
/grok:transfer
/grok:transfer --source ~/.claude/projects/-Users-me-repo/<session-id>.jsonl
```

The plugin's existing `SessionStart` hook supplies the current transcript path automatically; `--source` is available as a manual override. The source must be under `~/.claude/projects`.

### `/grok:status`

Shows running and recent Grok jobs for the current repository.

Examples:

```bash
/grok:status
/grok:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/grok:result`

Shows the final stored Grok output for a finished job.
When available, it also includes the Grok session ID so you can reopen that run directly in Grok with `grok --resume <session-id>`.

Examples:

```bash
/grok:result
/grok:result task-abc123
```

### `/grok:cancel`

Cancels an active background Grok job.

Examples:

```bash
/grok:cancel
/grok:cancel task-abc123
```

### `/grok:setup`

Checks whether Grok is installed and authenticated.

You can also use `/grok:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/grok:setup --enable-review-gate
/grok:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Grok review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Grok loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/grok:review
```

### Hand A Problem To Grok

```bash
/grok:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/grok:adversarial-review --background
/grok:rescue --background investigate the flaky test
```

Then check in with:

```bash
/grok:status
/grok:result
```

## Grok Integration

The Grok Build plugin wraps the local [Grok Build CLI](https://x.ai/cli) headless mode (`grok -p`). It uses the `grok` binary installed in your environment and applies the same configuration and authentication as interactive Grok.

### Common Configurations

If you want to change the default reasoning effort or the default model that gets used by the plugin, you can define that inside your user-level or project-level Grok config. For example to always use `grok-4.5` on `high` for a specific project you can add the following to a `~/.grok/config.toml` or project-level Grok config:

```toml
# Example — see Grok Build docs for current keys
# model and reasoning defaults are controlled by Grok CLI config / flags
```

Your configuration will be picked up based on:

- user-level config in `~/.grok/config.toml`
- local auth in `~/.grok/auth.json` or `XAI_API_KEY`
- optional binary override via `GROK_BIN`

You can also pass per-run overrides:

```bash
/grok:rescue --model grok-4.5 --effort high fix the flaky suite
```

### Moving The Work Over To Grok

Delegated tasks and any [stop gate](#enabling-review-gate) run can also be directly resumed inside Grok by running `grok --resume` either with the specific session ID you received from running `/grok:result` or `/grok:status` or by selecting it from the session list.

This way you can review the Grok work or continue the work there.

## FAQ

### Do I need a separate Grok account for this plugin?

If you are already signed into Grok Build on this machine, that account should work immediately here too. This plugin uses your local Grok CLI authentication.

If you only use Claude Code today and have not used Grok Build yet, you will also need to sign in to Grok with either browser login or an API key. Run `/grok:setup` to check whether Grok is ready, and use `!grok login` (or `!grok login --device-auth`) if it is not. For CI/headless auth, set `XAI_API_KEY` from [console.x.ai](https://console.x.ai).

### Does the plugin use a separate Grok runtime?

No. This plugin delegates through your local [Grok Build CLI](https://x.ai/cli) on the same machine.

That means:

- it uses the same Grok install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Grok config I already have?

Yes. If you already use Grok Build, the plugin picks up the same [configuration](#common-configurations) and credentials.

### Can I keep using my current API key setup?

Yes. Because the plugin uses your local Grok CLI, your existing sign-in method and config still apply.

Set `XAI_API_KEY` when you want API-key auth instead of (or in addition to) browser login.

### Does setup actually verify my login?

Yes. `/grok:setup` checks that the `grok` binary is present, then runs a short live headless probe unless you pass `--skip-live-auth`. Cached `auth.json` alone is not treated as sufficient if the probe fails.

### What happens to jobs when I exit Claude?

Running Grok jobs for that Claude session are cancelled. **Finished** jobs stay in the registry so `/grok:result` still works after you come back.

### Why did transfer not fully import my Claude session?

Grok’s `import` command is best-effort and may skip some Claude transcript shapes. The plugin always writes a handoff markdown file under `.grok-plugin-handoffs/` you can open with `grok --prompt-file …`.

## Development

```bash
npm test
node scripts/bump-version.mjs --check
claude plugin validate .
```

Tests use a fake `grok` binary so CI does not need live Grok credentials. See [CONTRIBUTING.md](./CONTRIBUTING.md) for release steps.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Not affiliated with xAI or OpenAI.
