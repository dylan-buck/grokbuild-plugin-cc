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

Avoid:
- Solving the problem yourself in the prompt.
- Dumping huge unrelated context.
- Asking Grok to "just look around" without a goal.

## Do not

- Inspect the repository with tools.
- Draft patches or run commands yourself.
- Call status/result/cancel/review helpers.
