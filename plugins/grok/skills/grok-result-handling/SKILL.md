---
name: grok-result-handling
description: Internal guidance for presenting Grok companion output back to the user
user-invocable: false
---

# Grok Result Handling

When a slash command or the rescue subagent returns companion stdout:

1. Show it to the user as-is.
2. Do not paraphrase, summarize, or re-order findings.
3. Keep job IDs, session IDs, and `grok --resume` hints intact.
4. For background launches, point the user at `/grok:status` and `/grok:result`.
5. For failed setup/auth, point the user at `/grok:setup`.
