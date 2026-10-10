import { randomUUID } from "node:crypto";
import {
  recordCost,
  VendorError,
  type DispatchReceipt,
  type Guards,
  type Logger,
} from "agentic-core";

// Still image vendors. Each adapter below takes a prompt and returns
// image files from its vendor API. Dry run previews the route and
// returns no files. Dry run is the default everywhere.

export type ImageVendorName = "flux" | "ideogram" | "replicate" | "workers-ai";

export const IMAGE_VENDORS: readonly ImageVendorName[] = [
  "flux",
  "ideogram",
  "replicate",
  "workers-ai",
];

export function isImageVendorName(value: string): value is ImageVendorName {
  return (IMAGE_VENDORS as readonly string[]).includes(value);
}

export const FLUX_DEFAULT_MODEL = "flux-2-pro";
export const IDEOGRAM_DEFAULT_MODEL = "ideogram-4-5";
export const REPLICATE_DEFAULT_MODEL = "black-forest-labs/flux-schnell";
export const WORKERS_AI_DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export interface GeneratedImage {
  url?: string;
  base64?: string;
  resolution?: string;
  seed?: number;
}

export interface ImageGenOpts {
  width?: number;
  height?: number;
  seed?: number;
}

export interface ImageAdapter {
  readonly name: ImageVendorName;
  generate(prompt: string, opts?: ImageGenOpts): Promise<GeneratedImage[]>;
}

export interface VendorInfo {
  vendor: ImageVendorName;
  model: string;
  keyEnv: string;
  keyPresent: boolean;
  accountEnv?: string;
  accountPresent?: boolean;
}

export type EnvMap = Record<string, string | undefined>;

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: { env?: EnvMap } }).process;
  return proc?.env?.[key];
}

// Shared HTTP helpers. Every adapter throws VendorError on failure
// and never swallows one. Timeouts abort the request.

export interface AdapterHttpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

async function fetchJson(
  url: string,
  opts: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: BodyInit;
    fetchFn: typeof fetch;
    timeoutMs: number;
    label: string;
  },
): Promise<unknown> {
  let response: Response;
  try {
    response = await opts.fetchFn(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (error) {
    throw new VendorError(
      `${opts.label} request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new VendorError(`${opts.label} got status ${response.status}`, {
      status: response.status,
    });
  }
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new VendorError(`${opts.label} returned bad JSON`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  return undefined;
}

// Flux adapter. Talks to the Black Forest Labs API: create a task,
// then poll the polling URL until the status reads Ready.
// Docs: https://docs.bfl.ai/flux_2/flux2_text_to_image

export interface FluxAdapterOptions extends AdapterHttpOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export class FluxImageAdapter implements ImageAdapter {
  readonly name: ImageVendorName = "flux";
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(options: FluxAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? FLUX_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? "https://api.bfl.ai";
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxPolls = options.maxPolls ?? 60;
  }

  private key(): string {
    const found = this.apiKey ?? readEnv("BFL_API_KEY");
    if (!found) {
      throw new VendorError("flux adapter needs an API key (set BFL_API_KEY)");
    }
    return found;
  }

  async generate(prompt: string, opts: ImageGenOpts = {}): Promise<GeneratedImage[]> {
    const apiKey = this.key();
    const body: Record<string, unknown> = { prompt };
    if (opts.width !== undefined) body.width = opts.width;
    if (opts.height !== undefined) body.height = opts.height;
    if (opts.seed !== undefined) body.seed = opts.seed;
    const created = await fetchJson(`${this.baseUrl}/v1/${this.model}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      label: "flux",
    });
    if (
      !isRecord(created) ||
      typeof created.id !== "string" ||
      typeof created.polling_url !== "string"
    ) {
      throw new VendorError("flux returned a malformed create reply");
    }
    return this.poll(created.polling_url, apiKey);
  }

  private async poll(pollingUrl: string, apiKey: string): Promise<GeneratedImage[]> {
    for (let seen = 0; seen < this.maxPolls; seen += 1) {
      const got = await fetchJson(pollingUrl, {
        method: "GET",
        headers: { accept: "application/json", "x-key": apiKey },
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        label: "flux",
      });
      if (!isRecord(got) || typeof got.status !== "string") {
        throw new VendorError("flux returned a malformed poll reply");
      }
      if (got.status === "Ready") {
        const sample = isRecord(got.result) ? got.result.sample : undefined;
        const urls = stringList(sample);
        if (!urls || urls.length === 0) {
          throw new VendorError("flux ready reply carries no image");
        }
        return urls.map((url) => ({ url }));
      }
      if (got.status === "Error" || got.status === "Failed" || got.status.endsWith("Moderated")) {
        throw new VendorError(`flux generation ${got.status.toLowerCase()}`);
      }
      await sleep(this.pollIntervalMs);
    }
    throw new VendorError(`flux timed out after ${this.maxPolls} polls`);
  }
}

// Ideogram adapter. Posts a multipart form and reads the sync reply.
// Docs: https://developer.ideogram.ai/api-reference/images/generate/ideogram-4-5

export interface IdeogramAdapterOptions extends AdapterHttpOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class IdeogramImageAdapter implements ImageAdapter {
  readonly name: ImageVendorName = "ideogram";
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: IdeogramAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? IDEOGRAM_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? "https://api.ideogram.ai";
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private key(): string {
    const found = this.apiKey ?? readEnv("IDEOGRAM_API_KEY");
    if (!found) {
      throw new VendorError("ideogram adapter needs an API key (set IDEOGRAM_API_KEY)");
    }
    return found;
  }

  async generate(prompt: string, opts: ImageGenOpts = {}): Promise<GeneratedImage[]> {
    const apiKey = this.key();
    const sized = opts.width !== undefined || opts.height !== undefined;
    if (sized && (opts.width === undefined || opts.height === undefined)) {
      throw new VendorError("ideogram size needs width and height together");
    }
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("size", sized ? `${opts.width}x${opts.height}` : "auto");
    form.set("num_images", "1");
    if (opts.seed !== undefined) form.set("seed", String(opts.seed));
    const made = await fetchJson(`${this.baseUrl}/v2/image/generate/${this.model}`, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: form,
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      label: "ideogram",
    });
    if (!isRecord(made) || !Array.isArray(made.data)) {
      throw new VendorError("ideogram returned a malformed reply");
    }
    if (made.data.length === 0) {
      throw new VendorError("ideogram returned no images");
    }
    return made.data.map((item: unknown) => {
      if (!isRecord(item)) {
        throw new VendorError("ideogram returned a malformed image");
      }
      if (item.is_image_safe === false || typeof item.url !== "string" || item.url.length === 0) {
        throw new VendorError("ideogram image failed safety checks");
      }
      const out: GeneratedImage = { url: item.url };
      if (typeof item.resolution === "string") out.resolution = item.resolution;
      if (typeof item.seed === "number") out.seed = item.seed;
      return out;
    });
  }
}

// Replicate adapter. Creates a prediction on an official model with
// Prefer: wait, then polls the prediction URL when it stays open.
// Docs: https://replicate.com/docs/reference/http

export interface ReplicateAdapterOptions extends AdapterHttpOptions {
  apiToken?: string;
  model?: string;
  baseUrl?: string;
  waitSeconds?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface ReplicatePrediction {
  status: string;
  output?: unknown;
  urls?: { get?: string };
  error?: unknown;
}

function asPrediction(value: unknown): ReplicatePrediction | undefined {
  if (!isRecord(value) || typeof value.status !== "string") return undefined;
  const urls = isRecord(value.urls) ? value.urls : undefined;
  const get = urls && typeof urls.get === "string" ? urls.get : undefined;
  return { status: value.status, output: value.output, urls: { get }, error: value.error };
}

export class ReplicateImageAdapter implements ImageAdapter {
  readonly name: ImageVendorName = "replicate";
  private readonly apiToken?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly waitSeconds: number;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(options: ReplicateAdapterOptions = {}) {
    this.apiToken = options.apiToken;
    this.model = options.model ?? REPLICATE_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? "https://api.replicate.com";
    this.waitSeconds = options.waitSeconds ?? 60;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxPolls = options.maxPolls ?? 60;
  }

  private token(): string {
    const found = this.apiToken ?? readEnv("REPLICATE_API_TOKEN");
    if (!found) {
      throw new VendorError("replicate adapter needs a token (set REPLICATE_API_TOKEN)");
    }
    return found;
  }

  async generate(prompt: string, opts: ImageGenOpts = {}): Promise<GeneratedImage[]> {
    const token = this.token();
    const input: Record<string, unknown> = { prompt, num_outputs: 1 };
    if (opts.seed !== undefined) input.seed = opts.seed;
    const headers = {
      Authorization: `Bearer ${token}`,
      Prefer: `wait=${this.waitSeconds}`,
      "content-type": "application/json",
    };
    const started = await fetchJson(`${this.baseUrl}/v1/models/${this.model}/predictions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input }),
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      label: "replicate",
    });
    let current = asPrediction(started);
    if (!current) {
      throw new VendorError("replicate returned a malformed prediction");
    }
    for (let seen = 0; seen < this.maxPolls; seen += 1) {
      if (current.status === "succeeded") {
        const urls = stringList(current.output);
        if (!urls || urls.length === 0) {
          throw new VendorError("replicate reply carries no image");
        }
        return urls.map((url) => ({ url }));
      }
      if (current.status === "failed" || current.status === "canceled") {
        const detail = typeof current.error === "string" ? `: ${current.error}` : "";
        throw new VendorError(`replicate prediction ${current.status}${detail}`);
      }
      const getUrl = current.urls?.get;
      if (!getUrl) {
        throw new VendorError("replicate reply carries no poll URL");
      }
      await sleep(this.pollIntervalMs);
      const next = await fetchJson(getUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        label: "replicate",
      });
      current = asPrediction(next);
      if (!current) {
        throw new VendorError("replicate returned a malformed prediction");
      }
    }
    throw new VendorError(`replicate timed out after ${this.maxPolls} polls`);
  }
}

// Workers AI adapter. Runs a text-to-image model over the REST API
// and reads the base64 image from the result envelope.
// Docs: https://developers.cloudflare.com/workers-ai/get-started/rest-api/

export interface WorkersAiAdapterOptions extends AdapterHttpOptions {
  apiToken?: string;
  accountId?: string;
  model?: string;
  baseUrl?: string;
}

export class WorkersAiImageAdapter implements ImageAdapter {
  readonly name: ImageVendorName = "workers-ai";
  private readonly apiToken?: string;
  private readonly accountId?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WorkersAiAdapterOptions = {}) {
    this.apiToken = options.apiToken;
    this.accountId = options.accountId;
    this.model = options.model ?? WORKERS_AI_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? "https://api.cloudflare.com";
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private credentials(): { token: string; accountId: string } {
    const token = this.apiToken ?? readEnv("CLOUDFLARE_API_TOKEN");
    if (!token) {
      throw new VendorError("workers-ai adapter needs a token (set CLOUDFLARE_API_TOKEN)");
    }
    const accountId = this.accountId ?? readEnv("CLOUDFLARE_ACCOUNT_ID");
    if (!accountId) {
      throw new VendorError("workers-ai adapter needs an account id (set CLOUDFLARE_ACCOUNT_ID)");
    }
    return { token, accountId };
  }

  async generate(prompt: string, opts: ImageGenOpts = {}): Promise<GeneratedImage[]> {
    const { token, accountId } = this.credentials();
    const body: Record<string, unknown> = { prompt };
    if (opts.seed !== undefined) body.seed = opts.seed;
    const ran = await fetchJson(
      `${this.baseUrl}/client/v4/accounts/${accountId}/ai/run/${this.model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        label: "workers-ai",
      },
    );
    if (!isRecord(ran)) {
      throw new VendorError("workers-ai returned a malformed reply");
    }
    if (ran.success !== true) {
      const errors = Array.isArray(ran.errors)
        ? ran.errors
            .map((entry) => (isRecord(entry) && typeof entry.message === "string" ? entry.message : null))
            .filter((line): line is string => line !== null)
            .join("; ")
        : "";
      throw new VendorError(`workers-ai run failed${errors ? `: ${errors}` : ""}`);
    }
    const result = ran.result;
    const direct = isRecord(result) && typeof result.image === "string" ? [result.image] : undefined;
    const listed = direct ?? (Array.isArray(result) ? stringList(result) : undefined);
    if (!listed || listed.length === 0) {
      throw new VendorError("workers-ai reply carries no image");
    }
    return listed.map((base64) => ({ base64 }));
  }
}

// Vendor status. Reports which keys exist without printing them.

export function listVendors(env: EnvMap = (readEnvAll())): VendorInfo[] {
  const present = (key: string): boolean => (env[key] ?? "").length > 0;
  const accountPresent = present("CLOUDFLARE_ACCOUNT_ID");
  return [
    {
      vendor: "flux",
      model: FLUX_DEFAULT_MODEL,
      keyEnv: "BFL_API_KEY",
      keyPresent: present("BFL_API_KEY"),
    },
    {
      vendor: "ideogram",
      model: IDEOGRAM_DEFAULT_MODEL,
      keyEnv: "IDEOGRAM_API_KEY",
      keyPresent: present("IDEOGRAM_API_KEY"),
    },
    {
      vendor: "replicate",
      model: REPLICATE_DEFAULT_MODEL,
      keyEnv: "REPLICATE_API_TOKEN",
      keyPresent: present("REPLICATE_API_TOKEN"),
    },
    {
      vendor: "workers-ai",
      model: WORKERS_AI_DEFAULT_MODEL,
      keyEnv: "CLOUDFLARE_API_TOKEN",
      keyPresent: present("CLOUDFLARE_API_TOKEN"),
      accountEnv: "CLOUDFLARE_ACCOUNT_ID",
      accountPresent: accountPresent,
    },
  ];
}

function readEnvAll(): EnvMap {
  const proc = (globalThis as { process?: { env?: EnvMap } }).process;
  return proc?.env ?? {};
}

// Generate entry. Checks guards, routes to one vendor, records cost.
// Dry run is the default: it checks guards, calls no adapter,
// records no cost, and returns the preview.

export interface GenerateImageOptions extends ImageGenOpts {
  vendor?: string;
  dryRun?: boolean;
  guards?: Guards;
  logger?: Logger;
  adapters?: Partial<Record<ImageVendorName, ImageAdapter>>;
}

export interface ImageResult {
  dryRun: boolean;
  vendor: ImageVendorName;
  prompt: string;
  images: GeneratedImage[];
  receipt?: DispatchReceipt;
}

function defaultAdapterFor(vendor: ImageVendorName): ImageAdapter {
  switch (vendor) {
    case "flux":
      return new FluxImageAdapter();
    case "ideogram":
      return new IdeogramImageAdapter();
    case "replicate":
      return new ReplicateImageAdapter();
    case "workers-ai":
      return new WorkersAiImageAdapter();
  }
}

export async function generateImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<ImageResult> {
  const vendorName = options.vendor ?? "flux";
  if (!isImageVendorName(vendorName)) {
    throw new Error(`unknown vendor "${vendorName}" (use ${IMAGE_VENDORS.join(", ")})`);
  }
  options.guards?.checkDispatch(prompt);
  if ((options.dryRun ?? true) === true) {
    options.logger?.info(`dry run: would generate with ${vendorName}`);
    const sized = options.width !== undefined && options.height !== undefined;
    const preview: GeneratedImage = {
      resolution: sized ? `${options.width}x${options.height}` : "1024x1024",
    };
    if (options.seed !== undefined) preview.seed = options.seed;
    return { dryRun: true, vendor: vendorName, prompt, images: [preview] };
  }
  const adapter = options.adapters?.[vendorName] ?? defaultAdapterFor(vendorName);
  const images = await adapter.generate(prompt, {
    width: options.width,
    height: options.height,
    seed: options.seed,
  });
  options.guards?.recordDispatch();
  recordCost({ kind: "image", adapter: vendorName, units: images.length });
  options.logger?.info(`generated ${images.length} image(s) via ${vendorName}`);
  return {
    dryRun: false,
    vendor: vendorName,
    prompt,
    images,
    receipt: {
      adapter: vendorName,
      id: randomUUID(),
      chars: prompt.length,
      at: new Date().toISOString(),
    },
  };
}
