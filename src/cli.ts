#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getCostReport, GuardError, VendorError } from "agentic-core";
import { DEFAULT_BRAND } from "./index.js";
import {
  generateImage,
  IMAGE_VENDORS,
  isImageVendorName,
  listVendors,
  type GenerateImageOptions,
  type ImageResult,
  type ImageVendorName,
  type VendorInfo,
} from "./images.js";
import { VERSION } from "./version.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliCommand = "generate" | "vendors" | "costs" | "mcp" | "help" | "version";

export interface CliRequest {
  command: CliCommand;
  prompt?: string;
  file?: string;
  vendor?: ImageVendorName;
  width?: number;
  height?: number;
  seed?: number;
  live: boolean;
  dryRun: boolean;
}

function parseIntFlag(value: string, flag: string, min: number): number {
  const found = Number.parseInt(value, 10);
  if (!Number.isInteger(found) || found < min) {
    throw new UsageError(`${flag} needs an integer of ${min} or more, got "${value}"`);
  }
  return found;
}

export function parseArgs(argv: string[]): CliRequest {
  const request: CliRequest = { command: "help", live: false, dryRun: false };
  const args = [...argv];
  const first = args.shift();
  if (first === undefined || first === "--help" || first === "-h") {
    return request;
  }
  if (first === "--version" || first === "-V") {
    request.command = "version";
    return request;
  }
  if (first !== "generate" && first !== "vendors" && first !== "costs" && first !== "mcp") {
    throw new UsageError(`unknown command "${first}"`);
  }
  request.command = first;
  while (args.length > 0) {
    const flag = args.shift() as string;
    if (flag === "--live" && request.command === "generate") {
      request.live = true;
      continue;
    }
    if (flag === "--dry-run" && request.command === "generate") {
      request.dryRun = true;
      continue;
    }
    if (
      (flag === "--prompt" ||
        flag === "--file" ||
        flag === "--vendor" ||
        flag === "--width" ||
        flag === "--height" ||
        flag === "--seed") &&
      args.length > 0
    ) {
      const value = args.shift() as string;
      if (flag === "--prompt") request.prompt = value;
      if (flag === "--file") request.file = value;
      if (flag === "--vendor") {
        if (!isImageVendorName(value)) {
          throw new UsageError(`unknown vendor "${value}" (use ${IMAGE_VENDORS.join(", ")})`);
        }
        request.vendor = value;
      }
      if (flag === "--width") request.width = parseIntFlag(value, "--width", 1);
      if (flag === "--height") request.height = parseIntFlag(value, "--height", 1);
      if (flag === "--seed") request.seed = parseIntFlag(value, "--seed", 0);
      continue;
    }
    throw new UsageError(`unknown flag "${flag}" for "${request.command}"`);
  }
  if (request.command === "generate" && request.prompt === undefined && request.file === undefined) {
    throw new UsageError(`generate needs --prompt or --file`);
  }
  return request;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): string;
  runGenerate(prompt: string, opts: GenerateImageOptions): Promise<ImageResult>;
  readVendors(): VendorInfo[];
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readFile: (path) => readFileSync(path, "utf8"),
    runGenerate: (prompt, opts) => generateImage(prompt, opts),
    readVendors: () => listVendors(),
  };
}

function helpText(): string {
  const command = DEFAULT_BRAND.command;
  return [
    `${DEFAULT_BRAND.name} ${VERSION}`,
    `${DEFAULT_BRAND.description}`,
    "",
    `Usage: ${command} <command> [flags]`,
    "",
    "Commands:",
    "  generate --prompt <p> [--file <p>] [--vendor <v>] [--width <n>] [--height <n>] [--seed <n>] [--live]  Make stills from a prompt. Previews by default.",
    "  vendors                                    List vendors, models, and key status.",
    "  costs                                      Print the cost report as JSON.",
    "  mcp                                        Start the MCP server on stdio.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
    `  Vendors: ${IMAGE_VENDORS.join(", ")}.`,
  ].join("\n");
}

function readInput(request: CliRequest, io: CliIo): string {
  if (request.file !== undefined) {
    return io.readFile(request.file);
  }
  return request.prompt ?? "";
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(`Run "${DEFAULT_BRAND.command} --help" for usage.`);
    return 2;
  }
  try {
    switch (request.command) {
      case "help":
        io.out(helpText());
        return 0;
      case "version":
        io.out(VERSION);
        return 0;
      case "generate": {
        const result = await io.runGenerate(readInput(request, io), {
          vendor: request.vendor,
          width: request.width,
          height: request.height,
          seed: request.seed,
          dryRun: request.dryRun || !request.live,
        });
        io.out(JSON.stringify(result));
        return 0;
      }
      case "vendors":
        io.out(JSON.stringify(io.readVendors()));
        return 0;
      case "costs":
        io.out(JSON.stringify(getCostReport()));
        return 0;
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp();
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof GuardError || error instanceof VendorError || error instanceof UsageError) {
      io.err(`${error.name}: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      io.err(`file not found: ${request.file ?? ""}`);
      return 1;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      // Exit nonzero at once. On zero, fall off the end so a running
      // server (mcp) keeps its stdio handles open. Plain commands
      // hold no handles and exit 0 on their own.
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
