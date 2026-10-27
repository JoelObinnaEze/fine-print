import * as z from "zod";

import { MATERIALS } from "../../engine/src/index.js";

const clauseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  enabled: z.boolean(),
  trigger: z.enum(["deposit", "process"]),
  points: z.number().int().min(0).max(10),
  eligibleOnly: z.boolean(),
  materials: z
    .array(z.enum(MATERIALS))
    .min(1)
    .max(MATERIALS.length)
    .refine((materials) => new Set(materials).size === materials.length, {
      error: "materials must not contain duplicates",
    }),
  repetition: z.enum(["every_event", "once_per_item"]),
});

export const policySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    clauses: z.array(clauseSchema).max(4),
  })
  .refine(
    (policy) =>
      new Set(policy.clauses.map((clause) => clause.id)).size ===
      policy.clauses.length,
    { error: "clause IDs must be unique", path: ["clauses"] },
  );

export type PolicyClause = z.infer<typeof clauseSchema>;
export type Policy = z.infer<typeof policySchema>;

export function parsePolicy(value: unknown): Policy {
  return policySchema.parse(value);
}
