---
description: Create a best-effort Claude→Grok handoff package from the current session
argument-hint: '[--source <claude-jsonl>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" transfer "$ARGUMENTS"`

Present the command output to the user without paraphrasing.
Explain that this is best-effort: Grok Build has no native Claude session importer (its `/import-claude` TUI command imports settings, not transcripts), so the handoff file is the transfer mechanism.
