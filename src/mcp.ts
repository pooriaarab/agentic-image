import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLogger, getCostReport, GuardError, VendorError, type Guards, type Logger } from "agentic-core";
import { DEFAULT_BRAND } from "./index.js";
import {
  generateImage,
  IMAGE_VENDORS,
  isImageVendorName,
  listVendors,
  type GenerateImageOptions,
  type ImageResult,
  type VendorInfo,
} from "./images.js";

export type McpGenerate = (prompt: string, opts?: GenerateImageOptions) => Promise<ImageResult>;

export interface McpDeps {
  generate?: McpGenerate;
  vendors?: () => VendorInfo[];
  guards?: Guards;
  logger?: Logger;
}

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function okResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const guards = deps.guards;
  const logger = deps.logger ?? createLogger({ quiet: true });
  const run: McpGenerate =
    deps.generate ?? ((prompt, opts) => generateImage(prompt, { ...opts, guards, logger }));
  const readVendors = deps.vendors ?? (() => listVendors());
  const server = new McpServer({
    name: DEFAULT_BRAND.command,
    version: DEFAULT_BRAND.version,
  });

  server.registerTool(
    "generate_image",
    {
      description:
        "Make still images from a prompt with one vendor. Previews by default; pass dryRun false to send.",
      inputSchema: {
        prompt: z.string().describe("The prompt to render."),
        vendor: z
          .string()
          .optional()
          .describe(`One of ${IMAGE_VENDORS.join(", ")}. Defaults to flux.`),
        width: z.number().int().optional().describe("Output width in pixels."),
        height: z.number().int().optional().describe("Output height in pixels."),
        seed: z.number().int().optional().describe("Seed for repeat runs."),
        dryRun: z.boolean().optional().describe("Preview the route without delivery. Defaults to true."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ prompt, vendor, width, height, seed, dryRun }) => {
      try {
        if (vendor !== undefined && !isImageVendorName(vendor)) {
          return errorResult(new Error(`unknown vendor "${vendor}" (use ${IMAGE_VENDORS.join(", ")})`));
        }
        return okResult(await run(prompt, { vendor, width, height, seed, dryRun: dryRun ?? true }));
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "list_vendors",
    {
      description: "List vendors, models, and key status.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(readVendors()),
  );

  server.registerTool(
    "get_cost_report",
    {
      description: "Read the cost report for this session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(getCostReport()),
  );

  return server;
}

export async function startMcp(deps: McpDeps = {}): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
