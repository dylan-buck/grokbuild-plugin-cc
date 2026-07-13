---
description: Show the final stored Grok output for a finished job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result "$ARGUMENTS"`

Present the command output to the user without paraphrasing.
When a Grok session ID is present, keep the `grok --resume <session-id>` hint visible.
