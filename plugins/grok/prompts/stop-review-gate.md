<task>
Run a stop-gate review of the previous Claude turn.
Only block if that turn made code changes that still have material issues.

{{CLAUDE_RESPONSE_BLOCK}}
</task>

<rules>
- Pure status, setup, review output, or reporting does not count as reviewable work.
- If the previous turn did not make direct code edits, allow immediately.
- If the working tree context below is empty or unrelated to the last turn, prefer ALLOW.
- Challenge whether the specific work and design choices should ship.
- Do not use tools. Review only the embedded context and previous response.
</rules>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>

<output>
If using structured JSON schema, return only that schema.
Otherwise your first line must be exactly one of:
- ALLOW: <short reason>
- BLOCK: <short reason>
Do not put anything before that first line.
</output>

<policy>
Use ALLOW if there are no material issues or no edit-producing work.
Use BLOCK only for concrete, defensible problems that still need fixing before stop.
</policy>
