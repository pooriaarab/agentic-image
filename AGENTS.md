# agentic-image agent guide

Route image prompts across Flux, Ideogram, Replicate, and Workers AI.

## Mental model

A prompt goes in. One vendor makes the still. One core serves all three faces, so each face returns the same shape. Dry run is the default, so a call previews until you ask for a real one.

## The three faces

- SDK: `import { generateImage } from "agentic-image"`.
- CLI: `npx agentic-image generate --prompt "..."`.
- MCP: `npx agentic-image mcp`, then call a tool below.

Keywords: image-generation, flux, agentic-suite, claude-code, codex, cli, mcp.

## MCP tools

| Tool | Use it for |
| --- | --- |
| generate_image | Make stills from a prompt. Previews by default. |
| list_vendors | List vendors, models, and key status. |
| get_cost_report | Read session cost totals. |

## The loop

1. Discover the tools with `tools/list`.
2. Run `list_vendors` and note which keys exist.
3. Preview a route with `generate_image` and dryRun true.
4. Run the real route with dryRun false when the preview looks right.
5. Read `get_cost_report` and state the cost.

## Rules

- Preview with dry run before each real dispatch.
- Stop when a guard denies the call. State the reason.
- Never retry a denied call with changed text to dodge a guard.
- Report adapter errors as errors. Never present them as success.
- State the cost report before you claim the task is done.
