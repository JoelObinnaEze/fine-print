import * as z from "zod";

import { actionSchema } from "../../../../packages/engine/src/actions.js";
import { policySchema } from "../../../../packages/policy/src/schema.js";

export const runIdSchema = z.uuid();
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const createRunSchema = z.strictObject({
  policy: policySchema,
  actions: z.array(actionSchema).max(120),
});

export const replayUnderPolicySchema = z.strictObject({ policy: policySchema });

export const branchRunSchema = z.strictObject({
  branchTick: z.number().int().min(0).max(120),
  policy: policySchema,
  actions: z.array(actionSchema).max(120),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;
