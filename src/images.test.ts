import { afterEach, describe, expect, test } from "vitest";
import { createGuards, GuardError, resetCosts, VendorError } from "agentic-core";
import {
  FluxImageAdapter,
  generateImage,
  IdeogramImageAdapter,
  isImageVendorName,
  listVendors,
  ReplicateImageAdapter,
  WorkersAiImageAdapter,
  type ImageAdapter,
  type ImageGenOpts,
} from "./images.js";

type StubReply = { status: number; body: unknown } | { throws: unknown };

interface StubCall {
  url: string;
  init: Record<string, unknown>;
}

function createFetchStub(replies: StubReply[]): {
  fetchFn: typeof fetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  let index = 0;
  const fetchFn = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as Record<string, unknown> });
    const next = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (typeof next === "object" && next !== null && "throws" in next) {
      throw (next as { throws: unknown }).throws;
    }
    const { status, body } = next as { status: number; body: unknown };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const ENV_KEYS = [
  "BFL_API_KEY",
  "IDEOGRAM_API_KEY",
  "REPLICATE_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];

const savedEnv: Record<string, string | undefined> = {};

function clearKeys(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const found = savedEnv[key];
    if (found === undefined) delete process.env[key];
    else process.env[key] = found;
  }
  resetCosts();
});

function headersOf(call: StubCall): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

describe("isImageVendorName", () => {
  test("accepts the four vendors", () => {
    for (const name of ["flux", "ideogram", "replicate", "workers-ai"]) {
      expect(isImageVendorName(name)).toBe(true);
    }
    expect(isImageVendorName("other")).toBe(false);
  });
});

describe("FluxImageAdapter", () => {
  test("creates a task then polls until ready", async () => {
    const { fetchFn, calls } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Pending" } },
      { status: 200, body: { status: "Ready", result: { sample: "https://img.test/a.jpg" } } },
    ]);
    const adapter = new FluxImageAdapter({ apiKey: "k", fetchFn, pollIntervalMs: 0 });
    const images = await adapter.generate("a cat", { width: 512, height: 512, seed: 7 });
    expect(images).toEqual([{ url: "https://img.test/a.jpg" }]);
    expect(calls[0].url).toBe("https://api.bfl.ai/v1/flux-2-pro");
    expect(headersOf(calls[0])["x-key"]).toBe("k");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      prompt: "a cat",
      width: 512,
      height: 512,
      seed: 7,
    });
    expect(calls[1].url).toBe("https://poll.test/r1");
  });

  test("reads the key from the environment", async () => {
    clearKeys();
    process.env.BFL_API_KEY = "env-key";
    const { fetchFn, calls } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Ready", result: { sample: ["https://img.test/a.jpg"] } } },
    ]);
    const images = await new FluxImageAdapter({ fetchFn, pollIntervalMs: 0 }).generate("hi");
    expect(images).toEqual([{ url: "https://img.test/a.jpg" }]);
    expect(headersOf(calls[0])["x-key"]).toBe("env-key");
  });

  test("throws without a key and calls nothing", async () => {
    clearKeys();
    const { fetchFn, calls } = createFetchStub([]);
    await expect(new FluxImageAdapter({ fetchFn }).generate("hi")).rejects.toThrow(VendorError);
    expect(calls).toHaveLength(0);
  });

  test("throws on a failed status", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Failed" } },
    ]);
    await expect(
      new FluxImageAdapter({ apiKey: "k", fetchFn, pollIntervalMs: 0 }).generate("hi"),
    ).rejects.toThrow(/failed/);
  });

  test("throws on moderation", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Content Moderated" } },
    ]);
    await expect(
      new FluxImageAdapter({ apiKey: "k", fetchFn, pollIntervalMs: 0 }).generate("hi"),
    ).rejects.toThrow(VendorError);
  });

  test("throws when polls run out", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Pending" } },
    ]);
    await expect(
      new FluxImageAdapter({ apiKey: "k", fetchFn, pollIntervalMs: 0, maxPolls: 2 }).generate("hi"),
    ).rejects.toThrow(/timed out/);
  });

  test("throws on a malformed create reply", async () => {
    const { fetchFn } = createFetchStub([{ status: 200, body: { nope: true } }]);
    await expect(new FluxImageAdapter({ apiKey: "k", fetchFn }).generate("hi")).rejects.toThrow(
      /malformed/,
    );
  });

  test("throws on a ready reply with no image", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { id: "r1", polling_url: "https://poll.test/r1" } },
      { status: 200, body: { status: "Ready", result: {} } },
    ]);
    await expect(
      new FluxImageAdapter({ apiKey: "k", fetchFn, pollIntervalMs: 0 }).generate("hi"),
    ).rejects.toThrow(/no image/);
  });

  test("throws on a non-2xx status with the status", async () => {
    const { fetchFn } = createFetchStub([{ status: 401, body: { error: "bad key" } }]);
    const error = await new FluxImageAdapter({ apiKey: "k", fetchFn })
      .generate("hi")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(401);
  });

  test("throws on a network failure", async () => {
    const { fetchFn } = createFetchStub([{ throws: new Error("down") }]);
    await expect(new FluxImageAdapter({ apiKey: "k", fetchFn }).generate("hi")).rejects.toThrow(
      VendorError,
    );
  });
});

describe("IdeogramImageAdapter", () => {
  test("posts a form and maps the sync reply", async () => {
    const { fetchFn, calls } = createFetchStub([
      {
        status: 200,
        body: {
          generation_id: "g1",
          seed: 3,
          data: [
            {
              prompt: "a cat",
              resolution: "1024x1024",
              is_image_safe: true,
              seed: 3,
              url: "https://img.test/b.png",
            },
          ],
        },
      },
    ]);
    const images = await new IdeogramImageAdapter({ apiKey: "k", fetchFn }).generate("a cat", {
      width: 1024,
      height: 1024,
      seed: 3,
    });
    expect(images).toEqual([{ url: "https://img.test/b.png", resolution: "1024x1024", seed: 3 }]);
    expect(calls[0].url).toBe("https://api.ideogram.ai/v2/image/generate/ideogram-4-5");
    expect(headersOf(calls[0])["Api-Key"]).toBe("k");
    const form = calls[0].init.body as FormData;
    expect(form.get("prompt")).toBe("a cat");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("seed")).toBe("3");
  });

  test("uses auto size without dimensions", async () => {
    const { fetchFn, calls } = createFetchStub([
      {
        status: 200,
        body: {
          generation_id: "g1",
          data: [{ prompt: "x", resolution: "1024x1024", is_image_safe: true, url: "https://img.test/c.png" }],
        },
      },
    ]);
    await new IdeogramImageAdapter({ apiKey: "k", fetchFn }).generate("x");
    expect((calls[0].init.body as FormData).get("size")).toBe("auto");
  });

  test("throws when only one side is set", async () => {
    const { fetchFn, calls } = createFetchStub([]);
    await expect(
      new IdeogramImageAdapter({ apiKey: "k", fetchFn }).generate("x", { width: 512 }),
    ).rejects.toThrow(/width and height/);
    expect(calls).toHaveLength(0);
  });

  test("throws when the image fails safety checks", async () => {
    const { fetchFn } = createFetchStub([
      {
        status: 200,
        body: {
          generation_id: "g1",
          data: [{ prompt: "x", resolution: "1x1", is_image_safe: false, url: "" }],
        },
      },
    ]);
    await expect(new IdeogramImageAdapter({ apiKey: "k", fetchFn }).generate("x")).rejects.toThrow(
      /safety/,
    );
  });

  test("throws on an empty data list", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { generation_id: "g1", data: [] } },
    ]);
    await expect(new IdeogramImageAdapter({ apiKey: "k", fetchFn }).generate("x")).rejects.toThrow(
      /no images/,
    );
  });

  test("throws without a key", async () => {
    clearKeys();
    const { fetchFn, calls } = createFetchStub([]);
    await expect(new IdeogramImageAdapter({ fetchFn }).generate("x")).rejects.toThrow(VendorError);
    expect(calls).toHaveLength(0);
  });

  test("throws on a non-2xx status", async () => {
    const { fetchFn } = createFetchStub([{ status: 402, body: { error: "no funds" } }]);
    const error = await new IdeogramImageAdapter({ apiKey: "k", fetchFn })
      .generate("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(402);
  });
});

describe("ReplicateImageAdapter", () => {
  test("reads an already finished prediction", async () => {
    const { fetchFn, calls } = createFetchStub([
      { status: 201, body: { id: "p1", status: "succeeded", output: ["https://img.test/d.png"] } },
    ]);
    const images = await new ReplicateImageAdapter({ apiToken: "t", fetchFn }).generate("a dog", {
      seed: 9,
    });
    expect(images).toEqual([{ url: "https://img.test/d.png" }]);
    expect(calls[0].url).toBe(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    );
    expect(headersOf(calls[0]).Authorization).toBe("Bearer t");
    expect(headersOf(calls[0]).Prefer).toBe("wait=60");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      input: { prompt: "a dog", num_outputs: 1, seed: 9 },
    });
  });

  test("polls until the prediction succeeds", async () => {
    const { fetchFn, calls } = createFetchStub([
      { status: 201, body: { id: "p1", status: "starting", urls: { get: "https://api.test/p1" } } },
      { status: 200, body: { id: "p1", status: "processing", urls: { get: "https://api.test/p1" } } },
      { status: 200, body: { id: "p1", status: "succeeded", output: "https://img.test/e.png" } },
    ]);
    const images = await new ReplicateImageAdapter({
      apiToken: "t",
      fetchFn,
      pollIntervalMs: 0,
    }).generate("x");
    expect(images).toEqual([{ url: "https://img.test/e.png" }]);
    expect(calls[1].url).toBe("https://api.test/p1");
  });

  test("throws on a failed prediction with the detail", async () => {
    const { fetchFn } = createFetchStub([
      { status: 201, body: { id: "p1", status: "failed", error: "boom" } },
    ]);
    await expect(new ReplicateImageAdapter({ apiToken: "t", fetchFn }).generate("x")).rejects.toThrow(
      /failed.*boom/,
    );
  });

  test("throws when a pending reply carries no poll URL", async () => {
    const { fetchFn } = createFetchStub([
      { status: 201, body: { id: "p1", status: "starting" } },
    ]);
    await expect(
      new ReplicateImageAdapter({ apiToken: "t", fetchFn, pollIntervalMs: 0 }).generate("x"),
    ).rejects.toThrow(/poll URL/);
  });

  test("throws without a token", async () => {
    clearKeys();
    const { fetchFn, calls } = createFetchStub([]);
    await expect(new ReplicateImageAdapter({ fetchFn }).generate("x")).rejects.toThrow(VendorError);
    expect(calls).toHaveLength(0);
  });

  test("throws on a non-2xx status", async () => {
    const { fetchFn } = createFetchStub([{ status: 422, body: { detail: "bad input" } }]);
    const error = await new ReplicateImageAdapter({ apiToken: "t", fetchFn })
      .generate("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(422);
  });
});

describe("WorkersAiImageAdapter", () => {
  test("runs the model and reads the base64 image", async () => {
    const { fetchFn, calls } = createFetchStub([
      { status: 200, body: { success: true, errors: [], result: { image: "aGVsbG8=" } } },
    ]);
    const images = await new WorkersAiImageAdapter({
      apiToken: "t",
      accountId: "a1",
      fetchFn,
    }).generate("a bird", { seed: 2 });
    expect(images).toEqual([{ base64: "aGVsbG8=" }]);
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/a1/ai/run/@cf/black-forest-labs/flux-1-schnell",
    );
    expect(headersOf(calls[0]).Authorization).toBe("Bearer t");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ prompt: "a bird", seed: 2 });
  });

  test("throws when success is false with the messages", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { success: false, errors: [{ message: "no credit" }], result: null } },
    ]);
    await expect(
      new WorkersAiImageAdapter({ apiToken: "t", accountId: "a1", fetchFn }).generate("x"),
    ).rejects.toThrow(/no credit/);
  });

  test("throws on a reply with no image", async () => {
    const { fetchFn } = createFetchStub([
      { status: 200, body: { success: true, errors: [], result: {} } },
    ]);
    await expect(
      new WorkersAiImageAdapter({ apiToken: "t", accountId: "a1", fetchFn }).generate("x"),
    ).rejects.toThrow(/no image/);
  });

  test("throws without a token or account", async () => {
    clearKeys();
    const { fetchFn, calls } = createFetchStub([]);
    await expect(
      new WorkersAiImageAdapter({ fetchFn }).generate("x"),
    ).rejects.toThrow(/token/);
    await expect(
      new WorkersAiImageAdapter({ apiToken: "t", fetchFn }).generate("x"),
    ).rejects.toThrow(/account/);
    expect(calls).toHaveLength(0);
  });

  test("throws on a non-2xx status", async () => {
    const { fetchFn } = createFetchStub([{ status: 403, body: { success: false } }]);
    const error = await new WorkersAiImageAdapter({ apiToken: "t", accountId: "a1", fetchFn })
      .generate("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(403);
  });
});

describe("listVendors", () => {
  test("reports key presence without values", () => {
    const found = listVendors({ BFL_API_KEY: "SECRET9", CLOUDFLARE_ACCOUNT_ID: "ACCT9" });
    expect(found).toHaveLength(4);
    expect(found[0]).toMatchObject({ vendor: "flux", keyEnv: "BFL_API_KEY", keyPresent: true });
    expect(found[1]).toMatchObject({ vendor: "ideogram", keyPresent: false });
    expect(found[3]).toMatchObject({
      vendor: "workers-ai",
      keyPresent: false,
      accountEnv: "CLOUDFLARE_ACCOUNT_ID",
      accountPresent: true,
    });
    expect(JSON.stringify(found)).not.toContain("SECRET9");
    expect(JSON.stringify(found)).not.toContain("ACCT9");
  });
});

describe("generateImage", () => {
  function countingAdapter(name: "flux" = "flux"): ImageAdapter & { calls: number } {
    const adapter = {
      calls: 0,
      name,
      generate: async (_prompt: string, _opts?: ImageGenOpts) => {
        adapter.calls += 1;
        return [{ url: "https://img.test/live.png" }];
      },
    };
    return adapter;
  }

  test("dry run is the default and calls no adapter", async () => {
    const adapter = countingAdapter();
    const result = await generateImage("a cat", { adapters: { flux: adapter } });
    expect(result).toMatchObject({ dryRun: true, vendor: "flux", prompt: "a cat" });
    expect(result.images).toEqual([{ resolution: "1024x1024" }]);
    expect(result.receipt).toBeUndefined();
    expect(adapter.calls).toBe(0);
  });

  test("dry run keeps size and seed in the preview", async () => {
    const result = await generateImage("x", { width: 512, height: 768, seed: 4 });
    expect(result.images).toEqual([{ resolution: "512x768", seed: 4 }]);
  });

  test("live run routes, records cost, and returns a receipt", async () => {
    const adapter = countingAdapter();
    const { getCostReport } = await import("agentic-core");
    const result = await generateImage("a cat", { dryRun: false, adapters: { flux: adapter } });
    expect(result.dryRun).toBe(false);
    expect(result.images).toEqual([{ url: "https://img.test/live.png" }]);
    expect(result.receipt).toMatchObject({ adapter: "flux", chars: 5 });
    expect(adapter.calls).toBe(1);
    expect(getCostReport().units).toBe(1);
  });

  test("a denied guard throws before the adapter runs", async () => {
    const adapter = countingAdapter();
    const guards = createGuards({ blocklist: ["nope"] });
    await expect(
      generateImage("nope", { dryRun: false, guards, adapters: { flux: adapter } }),
    ).rejects.toThrow(GuardError);
    expect(adapter.calls).toBe(0);
  });

  test("dry run still checks guards", async () => {
    const guards = createGuards({ blocklist: ["nope"] });
    await expect(generateImage("nope", { guards })).rejects.toThrow(GuardError);
  });

  test("an unknown vendor throws", async () => {
    await expect(generateImage("x", { vendor: "other" })).rejects.toThrow(/unknown vendor/);
  });

  test("adapter failures surface as failures", async () => {
    const failing: ImageAdapter = {
      name: "flux",
      generate: async () => {
        throw new VendorError("vendor is down");
      },
    };
    await expect(generateImage("x", { dryRun: false, adapters: { flux: failing } })).rejects.toThrow(
      /vendor is down/,
    );
  });
});
