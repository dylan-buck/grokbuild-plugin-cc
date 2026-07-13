# Changelog

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
