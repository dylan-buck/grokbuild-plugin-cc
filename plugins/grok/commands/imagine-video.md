---
description: Generate a video with Grok Build Imagine (image_gen → image_to_video)
argument-hint: "[--background|--wait] [--image <path>]... [--model <model>] [description]"
allowed-tools: Bash(node:*)
---

Run the Grok companion Imagine Video command. This mirrors Grok Build's `/imagine-video` slash command: video starts from an image, so Grok stages a first frame with `image_gen` (or uses a provided reference) and animates it with `image_to_video`.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the companion with `--background`.
- If the request includes `--wait`, run in the foreground (default).
- `--background` and `--wait` are Claude Code execution flags. Do not treat them as part of the video description.
- `--model` and `--image <path>` are runtime flags. Preserve them for the companion call.

Operating rules:

- Invoke exactly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine-video <flags-and-description>
```

- Strip Claude-only `--wait` before calling the companion.
- Keep `--background`, `--model`, and each `--image <path>` when present.
- The remaining free text is the video description and must be preserved verbatim.
- Return the companion stdout verbatim. Do not paraphrase or summarize.
- If Grok is missing or unauthenticated, tell the user to run `/grok:setup`.
- If no description is provided, ask for one.
- Note: Imagine media generation may require SuperGrok (or equivalent plan access).
- Note: `--image` references are resolved to absolute paths and handed to `image_to_video` as source frames.
- Note: video runs are write-capable (shell access for FFmpeg assembly of multi-shot videos), like a default rescue run.

Examples of intended companion invocations:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine-video a cat playing piano in a jazz club
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine-video --image ./frame.png gentle camera push-in
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine-video --background neon motorcycle chase through rain
```
