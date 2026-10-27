import * as z from "zod";

import {
  actionSchema,
  canonicalHash,
  createBottleReturnState,
  ENGINE_VERSION,
} from "../../../../packages/engine/src/index.js";
import { hashReplay, replayActions, type ReplayResult } from "../../../../packages/evaluation/src/index.js";
import { policySchema, type Policy } from "../../../../packages/policy/src/index.js";

export const runProvenanceSchema = z.enum([
  "live_model",
  "recorded_model_replay",
  "manual",
  "scripted_fixture",
]);

export const runLimitsSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/), z.number().finite().nonnegative())
  .refine((limits) => Object.keys(limits).length <= 16, "too many run limits");

const exportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  engineVersion: z.string().min(1).max(32),
  runId: z.uuid(),
  parentRunId: z.uuid().nullable(),
  branchTick: z.number().int().min(0).max(120).nullable(),
  provenance: runProvenanceSchema,
  modelId: z.string().min(1).max(128).nullable(),
  limits: runLimitsSchema,
  usage: z
    .strictObject({
      requests: z.number().int().nonnegative(),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      actualUsd: z.number().finite().nonnegative(),
    })
    .nullable(),
  policy: policySchema,
  actions: z.array(actionSchema).max(120),
  initialStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  replayHash: z.string().regex(/^[a-f0-9]{64}$/),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type RunProvenance = z.infer<typeof runProvenanceSchema>;
export type RunLimits = z.infer<typeof runLimitsSchema>;
export type RunExport = z.infer<typeof exportSchema>;

interface CreateRunExportInput {
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly branchTick: number | null;
  readonly provenance: RunProvenance;
  readonly modelId: string | null;
  readonly limits: RunLimits;
  readonly usage: RunExport["usage"];
  readonly policy: Policy;
  readonly actions: RunExport["actions"];
}

export function createRunExport(input: CreateRunExportInput): RunExport {
  const initialState = createBottleReturnState();
  const replay = replayActions(initialState, input.actions, input.policy);
  const payload = {
    schemaVersion: 1 as const,
    engineVersion: ENGINE_VERSION,
    runId: input.runId,
    parentRunId: input.parentRunId,
    branchTick: input.branchTick,
    provenance: input.provenance,
    modelId: input.modelId,
    limits: input.limits,
    usage: input.usage,
    policy: input.policy,
    actions: input.actions,
    initialStateHash: canonicalHash({ engineVersion: ENGINE_VERSION, state: initialState }),
    replayHash: hashReplay(replay),
  };
  return exportSchema.parse({ ...payload, integrityHash: canonicalHash(payload) });
}

export function verifyRunExport(value: unknown): ReplayResult {
  const parsed = exportSchema.parse(value);
  if (parsed.engineVersion !== ENGINE_VERSION) {
    throw new Error("Run export engine version is unsupported.");
  }
  const { integrityHash, ...payload } = parsed;
  if (canonicalHash(payload) !== integrityHash) {
    throw new Error("Run export integrity check failed.");
  }
  const initialState = createBottleReturnState();
  if (
    canonicalHash({ engineVersion: ENGINE_VERSION, state: initialState }) !==
    parsed.initialStateHash
  ) {
    throw new Error("Run export initial state does not match this engine.");
  }
  const replay = replayActions(initialState, parsed.actions, parsed.policy);
  if (hashReplay(replay) !== parsed.replayHash) {
    throw new Error("Run export replay hash does not match its actions.");
  }
  return replay;
}
