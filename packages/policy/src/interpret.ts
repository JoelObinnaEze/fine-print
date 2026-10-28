import * as z from "zod";

import { policySchema, type Policy } from "./schema.js";

export const policyInterpretationSchema = z
  .strictObject({
    status: z.enum(["candidate", "ambiguous", "unsupported"]),
    reason: z.string().min(1).max(400),
    policy: policySchema,
  })
  .refine(
    (interpretation) =>
      interpretation.status === "candidate" || interpretation.policy.clauses.length === 0,
    { error: "non-candidate interpretations must not include policy clauses", path: ["policy"] },
  );

export type PolicyInterpretation = z.infer<typeof policyInterpretationSchema>;

export function parsePolicyInterpretation(value: unknown): PolicyInterpretation {
  return policyInterpretationSchema.parse(value);
}

export function requireCandidatePolicy(interpretation: PolicyInterpretation): Policy {
  if (interpretation.status !== "candidate") {
    throw new Error("Policy interpretation is not activatable.");
  }
  return interpretation.policy;
}

export const policyInterpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["candidate", "ambiguous", "unsupported"] },
    reason: { type: "string", minLength: 1, maxLength: 400 },
    policy: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        clauses: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" },
              enabled: { type: "boolean" },
              trigger: {
                type: "string",
                enum: ["deposit", "process", "hopper_threshold", "processed_batch"],
              },
              points: { type: "integer", minimum: 0, maximum: 10 },
              eligibleOnly: { type: "boolean" },
              materials: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                uniqueItems: true,
                items: {
                  type: "string",
                  enum: ["plastic", "aluminium", "carton", "rubbish"],
                },
              },
              repetition: { type: "string", enum: ["every_event", "once_per_item"] },
              batchSize: { type: "integer", minimum: 2, maximum: 8 },
            },
            required: [
              "id",
              "enabled",
              "trigger",
              "points",
              "eligibleOnly",
              "materials",
              "repetition",
            ],
          },
        },
      },
      required: ["schemaVersion", "clauses"],
    },
  },
  required: ["status", "reason", "policy"],
} as const;
