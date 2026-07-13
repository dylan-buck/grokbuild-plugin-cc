# Changelog

## 0.1.0

- Initial release modeled on OpenAI's codex-plugin-cc UX.
- Headless Grok runtime (`grok -p --output-format json`).
- Commands: setup, review, adversarial-review, rescue, status, result, cancel, transfer.
- Background job registry with cancel/status/result.
- Optional stop-time review gate.
- Best-effort Claude → Grok transfer handoff package.
