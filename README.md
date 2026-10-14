# agentic-image

[![npm version](https://img.shields.io/npm/v/agentic-image)](https://www.npmjs.com/package/agentic-image) [![Downloads/month](https://img.shields.io/npm/dm/agentic-image)](https://www.npmjs.com/package/agentic-image) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

[Package and API types](https://www.npmjs.com/package/agentic-image)

agentic-image is an open-source image generation wrapper for developers using Flux, Ideogram, Replicate, and Cloudflare Workers AI.

## Install

```sh
npm install agentic-image
```

Requires Node.js 18 or later. Includes TypeScript types and three direct runtime dependencies.

## Generate your first image preview

```sh
npx agentic-image generate --prompt "a red tractor at dawn"
```

Success prints JSON with `dryRun: true`, `vendor: "flux"`, and image resolution metadata. The preview creates no image.

For live generation, export your provider key in the shell. The package does not load `.env` files.

```sh
export BFL_API_KEY="your-key"
npx agentic-image generate --prompt "a red tractor at dawn" --live
```

Success prints `dryRun: false` and an image URL in `images`. Open that URL to view the image.

```js
import { generateImage, getCostReport } from "agentic-image";
console.log(await generateImage("a red tractor at dawn")); // Preview first.
console.log(getCostReport()); // Session accounting; not a provider invoice.
```

## How it works

```text
SDK / CLI / MCP -> generateImage -> dry-run preview OR one provider adapter
```

## Provider coverage

| Provider | Adapter | Environment variables |
| --- | --- | --- |
| Black Forest Labs Flux | Implemented HTTP + polling | `BFL_API_KEY` |
| Ideogram | Implemented HTTP | `IDEOGRAM_API_KEY` |
| Replicate | Implemented HTTP + polling | `REPLICATE_API_TOKEN` |
| Cloudflare Workers AI | Implemented HTTP | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

All four adapters have request implementations. Live credential verification is pending in this README review; key presence is not verification.

## Features and runtime surfaces

- Select one provider with `--vendor flux`, `ideogram`, `replicate`, or `workers-ai`.
- Preview by default; use `--live` or SDK option `dryRun: false` for provider requests.
- CLI commands: `generate`, `vendors`, `costs`, `mcp`; flags: `--help` and `--version`.
- Model Context Protocol (MCP): start `npx agentic-image mcp` for `generate_image`, `list_vendors`, and `get_cost_report`.
- The repository includes a self-hosted Worker entry with `GET /health` and `POST /generate`; it is not an npm export.

## Behavior limits and status

Flux and Replicate default to 60 polling iterations. HTTP failures raise errors; no automatic provider fallback exists.
Replicate and Workers AI ignore width and height. Ideogram requires both dimensions together.
Cost accounting is process-local. Separate CLI invocations do not share session totals.
This package provides no managed image service, file storage, or automatic image download.
Version 0.1.0 APIs can change. Use the repository issue tracker for support; access may require repository permissions.

## Contributing and releases

Run `npm run build && npm run typecheck && npm test` before pushing.
Then run `npm pack` and preview through the generated tarball's installed CLI.
The `release` branch publishes only when the package version is new.

## License

MIT.
