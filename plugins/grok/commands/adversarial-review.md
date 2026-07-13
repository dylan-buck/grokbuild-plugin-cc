---
description: Run a steerable adversarial Grok review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus text]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial Grok review through the shared companion.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues or apply patches.
- Return Grok's output verbatim.

Execution mode rules:
- If the raw arguments include `--wait`, run in the foreground.
- If the raw arguments include `--background`, run in a Claude background task.
- Otherwise estimate size (same heuristics as `/grok:review`) and ask once with `AskUserQuestion`:
  - recommended option first, suffix `(Recommended)`
  - options: `Wait for results` and `Run in background`

Argument handling:
- Preserve flags and focus text exactly.
- Extra text after flags is adversarial focus for Grok, not for you.

Foreground:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review "$ARGUMENTS"
```
Return stdout verbatim.

Background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review "$ARGUMENTS"`,
  description: "Grok adversarial review",
  run_in_background: true
})
```
Then tell the user the review started and to check `/grok:status`.
