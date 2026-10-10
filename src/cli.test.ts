import { describe, expect, test } from "vitest";
import { parseArgs, runCli, UsageError, type CliIo } from "./cli.js";
import type { GenerateImageOptions, ImageResult, VendorInfo } from "./images.js";

function testIo(overrides: Partial<CliIo> = {}): CliIo & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    readFile: (path) => `file:${path}`,
    runGenerate: async (prompt: string, opts: GenerateImageOptions): Promise<ImageResult> => ({
      dryRun: opts.dryRun ?? true,
      vendor: "flux",
      prompt,
      images: [{ resolution: "1024x1024" }],
    }),
    readVendors: (): VendorInfo[] => [
      { vendor: "flux", model: "flux-2-pro", keyEnv: "BFL_API_KEY", keyPresent: false },
    ],
    ...overrides,
  };
}

describe("parseArgs", () => {
  test("empty args print help", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  test("--version selects version", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
  });

  test("generate takes prompt, vendor, size, and seed", () => {
    expect(
      parseArgs([
        "generate",
        "--prompt",
        "hi",
        "--vendor",
        "replicate",
        "--width",
        "512",
        "--height",
        "768",
        "--seed",
        "3",
        "--live",
      ]),
    ).toEqual({
      command: "generate",
      prompt: "hi",
      vendor: "replicate",
      width: 512,
      height: 768,
      seed: 3,
      live: true,
      dryRun: false,
    });
  });

  test("generate previews by default", () => {
    const request = parseArgs(["generate", "--prompt", "hi"]);
    expect(request.live).toBe(false);
    expect(request.dryRun).toBe(false);
  });

  test("unknown command throws UsageError", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(UsageError);
  });

  test("unknown vendor throws UsageError", () => {
    expect(() => parseArgs(["generate", "--prompt", "hi", "--vendor", "other"])).toThrow(
      /unknown vendor/,
    );
  });

  test("generate without input throws", () => {
    expect(() => parseArgs(["generate"])).toThrow(/needs --prompt or --file/);
  });

  test("bad width throws", () => {
    expect(() => parseArgs(["generate", "--prompt", "hi", "--width", "wide"])).toThrow(/--width/);
  });

  test("zero width throws", () => {
    expect(() => parseArgs(["generate", "--prompt", "hi", "--width", "0"])).toThrow(/--width/);
  });
});

describe("runCli", () => {
  test("generate previews by default", async () => {
    const io = testIo();
    const code = await runCli(["generate", "--prompt", "a cat"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ dryRun: true, prompt: "a cat" });
  });

  test("generate --live sends for real", async () => {
    const io = testIo();
    const code = await runCli(["generate", "--prompt", "a cat", "--live"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ dryRun: false });
  });

  test("generate reads a file when asked", async () => {
    const io = testIo();
    const code = await runCli(["generate", "--file", "prompt.txt"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ prompt: "file:prompt.txt" });
  });

  test("vendors prints the vendor list", async () => {
    const io = testIo();
    const code = await runCli(["vendors"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toEqual([
      { vendor: "flux", model: "flux-2-pro", keyEnv: "BFL_API_KEY", keyPresent: false },
    ]);
  });

  test("bad usage exits 2", async () => {
    const io = testIo();
    const code = await runCli(["bogus"], io);
    expect(code).toBe(2);
    expect(io.errLines.length).toBeGreaterThan(0);
  });

  test("version prints a version string", async () => {
    const io = testIo();
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.outLines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
