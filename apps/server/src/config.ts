import * as z from "zod";

import {
  readMetaCompatibilityConfig,
  type MetaCompatibilityConfig,
} from "./providers/meta-compatibility.js";

const usd = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/)
  .transform(Number)
  .pipe(z.number().finite().min(0).max(10));

const rate = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/)
  .transform(Number)
  .pipe(z.number().finite().positive().max(100));

const budgetEnvironmentSchema = z.object({
  APP_BUDGET_USD: usd.default(0),
  EVENT_CREDITS_CONFIRMED: z.enum(["true", "false"]).default("false"),
  EVENT_CREDITS_REMAINING_USD: usd.default(0),
  LIVE_AGENT_ENABLED: z.enum(["true", "false"]).default("false"),
  MAX_CONCURRENT_PROVIDER_REQUESTS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(8))
    .default(1),
  META_INPUT_USD_PER_MILLION: rate.default(1.25),
  META_OUTPUT_USD_PER_MILLION: rate.default(4.25),
  SEARCH_BUDGET_USD: usd.default(0.25),
  SESSION_BUDGET_USD: usd.default(2),
});

export interface ServerConfig {
  readonly databasePath: string;
  readonly provider: MetaCompatibilityConfig | null;
  readonly budgets: {
    readonly appUsd: number;
    readonly eventCreditsRemainingUsd: number;
    readonly effectiveAppUsd: number;
    readonly sessionUsd: number;
    readonly searchUsd: number;
  };
  readonly pricing: {
    readonly inputUsdPerMillion: number;
    readonly outputUsdPerMillion: number;
  };
  readonly maxConcurrentProviderRequests: number;
  readonly liveAgent: {
    readonly isRequested: boolean;
    readonly isEnabled: boolean;
    readonly reasons: readonly string[];
  };
}

export function readServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const databasePath = z.string().min(1).max(260).catch("fine-print.db").parse(environment.DATABASE_PATH);
  const budgetResult = budgetEnvironmentSchema.safeParse(environment);
  const values = budgetResult.success
    ? budgetResult.data
    : {
        APP_BUDGET_USD: 0,
        EVENT_CREDITS_CONFIRMED: "false" as const,
        EVENT_CREDITS_REMAINING_USD: 0,
        LIVE_AGENT_ENABLED: "false" as const,
        MAX_CONCURRENT_PROVIDER_REQUESTS: 1,
        META_INPUT_USD_PER_MILLION: 1.25,
        META_OUTPUT_USD_PER_MILLION: 4.25,
        SEARCH_BUDGET_USD: 0.25,
        SESSION_BUDGET_USD: 2,
      };
  let provider: MetaCompatibilityConfig | null = null;
  try {
    provider = readMetaCompatibilityConfig(environment);
  } catch {
    provider = null;
  }

  const allowanceUsd = Math.min(
    values.APP_BUDGET_USD,
    values.EVENT_CREDITS_REMAINING_USD,
  );
  const effectiveAppUsd = Math.max(0, allowanceUsd - Math.max(1, allowanceUsd * 0.1));
  const reasons: string[] = [];
  if (!budgetResult.success) reasons.push("Budget configuration is invalid.");
  if (values.LIVE_AGENT_ENABLED !== "true") reasons.push("Live agent is disabled.");
  if (values.EVENT_CREDITS_CONFIRMED !== "true") {
    reasons.push("Credit availability is not confirmed.");
  }
  if (effectiveAppUsd <= 0) reasons.push("A positive app budget is required.");
  if (values.SESSION_BUDGET_USD <= 0) reasons.push("A positive session budget is required.");
  if (values.SEARCH_BUDGET_USD <= 0) reasons.push("A positive search budget is required.");
  if (values.SESSION_BUDGET_USD > effectiveAppUsd) {
    reasons.push("Session budget exceeds the app budget.");
  }
  if (values.SEARCH_BUDGET_USD > values.SESSION_BUDGET_USD) {
    reasons.push("Search budget exceeds the session budget.");
  }
  if (values.MAX_CONCURRENT_PROVIDER_REQUESTS !== 1) {
    reasons.push("Provider concurrency must be 1.");
  }
  if (!provider) reasons.push("Meta credentials are not configured.");

  return {
    databasePath,
    provider,
    budgets: {
      appUsd: values.APP_BUDGET_USD,
      eventCreditsRemainingUsd: values.EVENT_CREDITS_REMAINING_USD,
      effectiveAppUsd,
      sessionUsd: values.SESSION_BUDGET_USD,
      searchUsd: values.SEARCH_BUDGET_USD,
    },
    pricing: {
      inputUsdPerMillion: values.META_INPUT_USD_PER_MILLION,
      outputUsdPerMillion: values.META_OUTPUT_USD_PER_MILLION,
    },
    maxConcurrentProviderRequests: values.MAX_CONCURRENT_PROVIDER_REQUESTS,
    liveAgent: {
      isRequested: values.LIVE_AGENT_ENABLED === "true",
      isEnabled: values.LIVE_AGENT_ENABLED === "true" && reasons.length === 0,
      reasons,
    },
  };
}
