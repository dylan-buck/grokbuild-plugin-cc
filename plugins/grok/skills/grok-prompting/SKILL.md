---
name: grok-prompting
description: Internal guidance for composing tight Grok prompts for coding, review, diagnosis, and research tasks
user-invocable: false
---

# Grok Prompting

Use only inside the rescue forwarder to tighten the task text before the single `task` call.

## Goals

- Preserve the user's intent exactly.
- Remove routing flags (`--background`, `--wait`, `--resume`, `--fresh`, `--model`, `--effort`).
- Make the request concrete: goal, constraints, success criteria.
- Prefer the smallest safe change unless the user asked for a redesign.

## Patterns

Good task prompts:
- Start with the outcome: "Fix the flaky auth test in apps/api by..."
- Name files or areas when known.
- State constraints: "no dependency upgrades", "keep public API stable".
- Define done: "tests pass", "minimal diff", "explain root cause".

Media / vision:
- When the user attaches or references image files for understanding or editing, prefer companion `--image <path>` flags over embedding huge base64 blobs in the prompt text.
- For pure image generation ("make a logo", "generate a hero image"), prefer `/grok:imagine` rather than a free-form rescue task so Grok uses the official `image_gen` instruction.
- For pure video generation, prefer `/grok:imagine-video`.
- Image/video generation may require SuperGrok; if Grok reports a tier restriction, surface that message as-is.

Avoid:
- Solving the problem yourself in the prompt.
- Dumping huge unrelated context.
- Asking Grok to "just look around" without a goal.
- Rewriting the user's image description when the intent is Imagine — the official contract is verbatim.

## Do not

- Inspect the repository with tools.
- Draft patches or run commands yourself.
- Call status/result/cancel/review helpers.
