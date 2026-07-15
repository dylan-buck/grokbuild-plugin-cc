---
description: Check whether the local Grok CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate] [--skip-live-auth]'
allowed-tools: Bash(node:*), Bash(curl:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup --json $ARGUMENTS
```

By default setup runs a short live headless probe to verify credentials. Pass `--skip-live-auth` only when offline.

If the result says Grok is unavailable:
- Use `AskUserQuestion` exactly once with two options:
  - `Install Grok Build (Recommended)`
  - `Skip for now`
- If the user chooses install, run the official installer, then rerun the setup command above:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

- On Windows, use PowerShell instead: `irm https://x.ai/cli/install.ps1 | iex`
- Do not use any other install method or source. If the installer fails, point the user at https://x.ai/cli and stop.
- If the user skips, tell them how to install Grok Build from https://x.ai/cli
- Mention they can set `GROK_BIN` if the binary is not on PATH

If Grok is installed but not authenticated:
- Preserve the guidance to run `!grok login` or set `XAI_API_KEY`

Output rules:
- Present the final setup output to the user.
