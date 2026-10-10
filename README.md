# Agentic image

Route image prompts across Flux, Ideogram, Replicate, and Workers AI.

One prompt goes in. One vendor makes the still. You pick the vendor, or you preview first.

Dry run is the default. The pack calls no vendor and spends nothing until you pass `--live`.

## Quick start

```sh
npm install -g agentic-image
agentic-image vendors
agentic-image generate --prompt "a red tractor at dawn"
```

The first command lists vendors and key status. The second previews the route. It returns JSON and makes no image.

Go live with one flag:

```sh
export BFL_API_KEY="your key here"
agentic-image generate --prompt "a red tractor at dawn" --live
```

Call the library:

```js
import { generateImage } from "agentic-image";

await generateImage("a red tractor at dawn"); // preview, dry run
await generateImage("a red tractor at dawn", { dryRun: false }); // real call
```

Start the MCP server:

```sh
agentic-image mcp
```

## Three usecases

1. You preview a prompt from the terminal before you spend.
2. You make a still with one vendor in a script.
3. You let an agent call `generate_image` as an MCP tool.

## Keys

| Vendor | Key |
| --- | --- |
| flux | BFL_API_KEY |
| ideogram | IDEOGRAM_API_KEY |
| replicate | REPLICATE_API_TOKEN |
| workers-ai | CLOUDFLARE_API_TOKEN plus CLOUDFLARE_ACCOUNT_ID |

`agentic-image vendors` reports which keys exist. It never prints a value.

## Commands

- `generate` makes stills from a prompt. It previews by default. Pass `--live` to send.
- `vendors` lists vendors, models, and key status.
- `costs` prints the cost report as JSON.
- `mcp` starts the MCP server on stdio.

## Gates

Run all three before you push:

```sh
npm run build && npm run typecheck && npm test
```

Then run the real installed CLI once from a tarball:

```sh
npm pack
npx --yes --package ./agentic-image-0.1.0.tgz agentic-image generate --prompt "hello"
```

## Release flow

Push to `main` for review. Merge to `release` to publish. The publish workflow ships only when the version is new.

## Layout

- `src/index.ts`: the library face.
- `src/cli.ts`: the terminal face.
- `src/mcp.ts`: the MCP server. `src/mcp-bin.ts` starts it.
- `src/worker.ts`: the edge worker face.
- `src/images.ts`: the vendor adapters and the generate entry.
- `agentic-core.d.ts`: the frozen contract.
- `docs/agentic-core.md`: the contract in plain words.

## License

MIT. See `LICENSE`.
