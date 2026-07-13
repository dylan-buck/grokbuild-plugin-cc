# Changelog

## 0.1.0

- Initial release modeled on OpenAI's codex-plugin-cc UX.
- Headless Grok runtime (`grok -p --output-format json --always-approve`).
- Commands: setup, review, adversarial-review, rescue, status, result, cancel, transfer.
- Background job registry with cancel/status/result (including companion-level `--background` for review/task).
- Optional stop-time review gate (read-only).
- Transfer: handoff markdown package + best-effort `grok import` when supported.
- Grok-native task flags: `--read`, `--worktree`, `--worktree-name`, `--worktree-ref`, `--check`, `--best-of-n`.
- Review isolation: correct Grok tool IDs, `--no-subagents`, `--disable-web-search`, embedded-diff prompts.
- Soft-success for structured reviews when JSON parses cleanly despite non-zero Grok exit.
- Transfer import has a 30s timeout and only treats explicit import outcomes as success.
