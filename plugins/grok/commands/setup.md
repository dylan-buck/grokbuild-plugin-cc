---
description: Check whether the local Grok CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate] [--skip-live-auth]'
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup --json $ARGUMENTS
```

By default setup runs a short live headless probe to verify credentials. Pass `--skip-live-auth` only when offline.

If the result says Grok is unavailable:
- Tell the user how to install Grok Build from https://x.ai/cli
- Mention they can set `GROK_BIN` if the binary is not on PATH

If Grok is installed but not authenticated:
- Preserve the guidance to run `!grok login` or set `XAI_API_KEY`

Output rules:
- Present the final setup output to the user.
