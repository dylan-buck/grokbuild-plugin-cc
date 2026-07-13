---
description: Show the stored final output for a finished Grok job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result "$ARGUMENTS"`

Present the command output to the user without paraphrasing.
When a Grok session ID is present, keep the `grok --resume <session-id>` hint visible.
