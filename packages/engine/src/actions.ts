import * as z from "zod";

const itemId = z.string().min(1).max(64);

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("move"),
    direction: z.enum(["up", "down", "left", "right"]),
  }),
  z.strictObject({ type: z.literal("take"), itemId }),
  z.strictObject({ type: z.literal("deposit") }),
  z.strictObject({ type: z.literal("retrieve"), itemId }),
  z.strictObject({ type: z.literal("process"), itemId }),
  z.strictObject({ type: z.literal("reject") }),
  z.strictObject({ type: z.literal("drop") }),
  z.strictObject({ type: z.literal("wait") }),
  z.strictObject({ type: z.literal("finish") }),
]);

export type Action = z.infer<typeof actionSchema>;

export function parseAction(value: unknown): Action {
  return actionSchema.parse(value);
}
