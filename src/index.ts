export { VERSION } from "./version.js";
export {
  defineBrand,
  createLogger,
  GuardError,
  VendorError,
  createGuards,
  LocalRouterAdapter,
  HttpRouterAdapter,
  recordCost,
  getCostReport,
  resetCosts,
  createDryRunResult,
  dispatchText,
  summarizeText,
} from "agentic-core";
export type {
  BrandConfig,
  LogLevel,
  Logger,
  LoggerOptions,
  CapsConfig,
  QuietHoursConfig,
  GuardsConfig,
  Guards,
  DispatchReceipt,
  RouterAdapter,
  HttpRouterOptions,
  CostEntry,
  CostReport,
  DispatchOptions,
  DispatchResult,
  TopWord,
  TextSummary,
  SummarizeOptions,
} from "agentic-core";
export {
  IMAGE_VENDORS,
  isImageVendorName,
  FLUX_DEFAULT_MODEL,
  IDEOGRAM_DEFAULT_MODEL,
  REPLICATE_DEFAULT_MODEL,
  WORKERS_AI_DEFAULT_MODEL,
  FluxImageAdapter,
  IdeogramImageAdapter,
  ReplicateImageAdapter,
  WorkersAiImageAdapter,
  listVendors,
  generateImage,
} from "./images.js";
export type {
  ImageVendorName,
  GeneratedImage,
  ImageGenOpts,
  ImageAdapter,
  VendorInfo,
  EnvMap,
  GenerateImageOptions,
  ImageResult,
  FluxAdapterOptions,
  IdeogramAdapterOptions,
  ReplicateAdapterOptions,
  WorkersAiAdapterOptions,
  AdapterHttpOptions,
} from "./images.js";

import { defineBrand, type BrandConfig } from "agentic-core";
import { VERSION } from "./version.js";

export const DEFAULT_BRAND: BrandConfig = defineBrand({
  name: "Agentic image",
  command: "agentic-image",
  description: "Route image prompts across Flux, Ideogram, Replicate, and Workers AI.",
  keywords: ["image-generation", "flux", "agentic-suite", "claude-code", "codex", "cli", "mcp"],
  version: VERSION,
});
