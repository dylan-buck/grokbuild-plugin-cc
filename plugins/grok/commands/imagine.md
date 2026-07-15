---
description: Generate an image with Grok Build Imagine (image_gen), optionally editing a source image
argument-hint: "[--background|--wait] [--edit <image-path>]... [--aspect <ratio>] [--model <model>] [description]"
allowed-tools: Bash(node:*)
---

Run the Grok companion Imagine command. This mirrors Grok Build's `/imagine` slash command: it expands to the official image_gen instruction and runs headlessly through the local Grok CLI.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the companion with `--background`.
- If the request includes `--wait`, run in the foreground (default).
- `--background` and `--wait` are Claude Code execution flags. Do not treat them as part of the image description.
- `--model`, `--aspect`, and `--edit <path>` are runtime flags. Preserve them for the companion call; do not treat them as part of the natural-language description.

Operating rules:

- Invoke exactly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine <flags-and-description>
```

- Strip Claude-only `--wait` before calling the companion.
- Keep `--background`, `--model`, `--aspect`, and each `--edit <path>` when present.
- The remaining free text is the image description and must be preserved verbatim.
- Return the companion stdout verbatim. Do not paraphrase or summarize.
- If Grok is missing or unauthenticated, tell the user to run `/grok:setup`.
- If no description is provided, ask for one.
- Note: Imagine image generation may require SuperGrok (or equivalent plan access). The Grok CLI will report tier restrictions when applicable.
- Note: `--model` selects the orchestrating Grok model. The image model itself is chosen by the `image_gen` tool.

Examples of intended companion invocations:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine a golden sunset over a calm ocean
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine --aspect 16:9 hero banner of a rocket launch
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine --edit ./ref.png make it watercolor
node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine --background neon cyberpunk city skyline
```
