import * as z from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const OFFICIAL_BASE_URL = "https://api.meta.ai/v1";

const environmentSchema = z.object({
  MODEL_API_KEY: z
    .string()
    .min(1)
    .max(4_096)
    .refine((key) => key === key.trim(), {
      error: "MODEL_API_KEY must not contain surrounding whitespace",
    }),
  META_BASE_URL: z.string().max(200).optional(),
  META_MODEL_ID: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
    .optional(),
});

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(128) })).max(1_000),
});

export interface MetaCompatibilityConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelId: string;
}

export interface MetaCompatibilityResult {
  readonly endpoint: string;
  readonly modelId: string;
  readonly modelAvailable: boolean;
  readonly modelCount: number;
}

export function readMetaCompatibilityConfig(
  environment: Record<string, string | undefined>,
): MetaCompatibilityConfig {
  const parsed = environmentSchema.parse(environment);
  const baseUrl = new URL(parsed.META_BASE_URL ?? OFFICIAL_BASE_URL);

  if (
    baseUrl.origin !== "https://api.meta.ai" ||
    baseUrl.pathname.replace(/\/$/, "") !== "/v1" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("META_BASE_URL must be https://api.meta.ai/v1");
  }

  return {
    apiKey: parsed.MODEL_API_KEY,
    baseUrl: OFFICIAL_BASE_URL,
    modelId: parsed.META_MODEL_ID ?? "muse-spark-1.3",
  };
}

export async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Meta Model API response exceeded 1 MB");
  }
  if (!response.body) {
    throw new Error("Meta Model API returned an empty response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Meta Model API response exceeded 1 MB");
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("Meta Model API returned invalid JSON");
  }
}

export async function checkMetaCompatibility(
  environment: Record<string, string | undefined>,
  fetchImplementation: typeof fetch = fetch,
): Promise<MetaCompatibilityResult> {
  const config = readMetaCompatibilityConfig(environment);
  const response = await fetchImplementation(`${config.baseUrl}/models`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Meta Model API returned HTTP ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Meta Model API returned an unexpected content type");
  }

  const catalog = modelListSchema.parse(await readBoundedJsonResponse(response));
  return {
    endpoint: config.baseUrl,
    modelId: config.modelId,
    modelAvailable: catalog.data.some((model) => model.id === config.modelId),
    modelCount: catalog.data.length,
  };
}
