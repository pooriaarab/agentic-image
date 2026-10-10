import { GuardError, VendorError } from "agentic-core";
import {
  FluxImageAdapter,
  generateImage,
  IdeogramImageAdapter,
  ReplicateImageAdapter,
  WorkersAiImageAdapter,
} from "./images.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  PACK_NAME?: string;
  BFL_API_KEY?: string;
  IDEOGRAM_API_KEY?: string;
  REPLICATE_API_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, pack: env.PACK_NAME ?? "agentic-image", version: VERSION });
    }
    if (request.method === "POST" && url.pathname === "/generate") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (!isRecord(body) || typeof body.prompt !== "string") {
        return json({ error: "body needs a prompt string" }, 400);
      }
      const vendor = typeof body.vendor === "string" ? body.vendor : undefined;
      const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : true;
      try {
        const result = await generateImage(body.prompt, {
          vendor,
          width: asOptionalInt(body.width),
          height: asOptionalInt(body.height),
          seed: asOptionalInt(body.seed),
          dryRun,
          adapters: {
            flux: new FluxImageAdapter(env.BFL_API_KEY ? { apiKey: env.BFL_API_KEY } : {}),
            ideogram: new IdeogramImageAdapter(
              env.IDEOGRAM_API_KEY ? { apiKey: env.IDEOGRAM_API_KEY } : {},
            ),
            replicate: new ReplicateImageAdapter(
              env.REPLICATE_API_TOKEN ? { apiToken: env.REPLICATE_API_TOKEN } : {},
            ),
            "workers-ai": new WorkersAiImageAdapter({
              ...(env.CLOUDFLARE_API_TOKEN ? { apiToken: env.CLOUDFLARE_API_TOKEN } : {}),
              ...(env.CLOUDFLARE_ACCOUNT_ID ? { accountId: env.CLOUDFLARE_ACCOUNT_ID } : {}),
            }),
          },
        });
        return json(result);
      } catch (error) {
        if (error instanceof GuardError) {
          return json({ error: error.message }, 403);
        }
        if (error instanceof VendorError) {
          return json({ error: error.message }, 502);
        }
        if (error instanceof Error && error.message.startsWith("unknown vendor")) {
          return json({ error: error.message }, 400);
        }
        return json({ error: "generate failed" }, 500);
      }
    }
    return json({ error: "not found" }, 404);
  },
};
