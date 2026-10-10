---
name: agentic-image
description: Route image prompts across Flux, Ideogram, Replicate, and Workers AI. Keywords: image-generation, flux, agentic-suite, claude-code, codex, cli, mcp.
---

# agentic-image

Route image prompts across Flux, Ideogram, Replicate, and Workers AI.

## Use the SDK

```js
import { generateImage, listVendors } from "agentic-image";

listVendors();
await generateImage("some prompt"); // preview, dry run
await generateImage("some prompt", { dryRun: false }); // real call
```

## Use the CLI

```sh
agentic-image vendors
agentic-image generate --prompt "some prompt"
agentic-image generate --prompt "some prompt" --live
```

## Use the MCP server

Start the server with `agentic-image mcp`. Call `generate_image`
for stills, `list_vendors` for vendor status, `get_cost_report` for costs.

## Rules

- Preview each route with dry run first.
- Report guard denials and adapter errors as failures.
- Read the cost report at the end.
