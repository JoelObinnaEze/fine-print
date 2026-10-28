import * as z from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/);
const dollarsSchema = z.number().int().min(0).max(10_000);

export const commercePolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  referral: z.strictObject({
    rewardUsd: z.number().int().min(1).max(100),
    qualifyingPurchaseUsd: z.number().int().min(1).max(10_000),
    qualificationBasis: z.enum(["gross_purchase", "cash_paid", "net_retained_spend"]),
    issuance: z.enum(["immediate", "pending", "after_return_window"]),
    refundHandling: z.enum(["keep", "reverse"]),
    returnWindowDays: z.number().int().min(1).max(365),
    promoCreditCountsTowardThreshold: z.boolean(),
  }),
});

export const commerceGoalSchema = z.strictObject({
  metric: z.literal("retained_revenue"),
  minimumUsd: z.number().int().min(1).max(10_000),
  description: z.string().trim().min(1).max(500),
});

export const commerceActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("refer"),
    referrerId: identifierSchema,
    customerId: identifierSchema,
  }),
  z
    .strictObject({
      type: z.literal("purchase"),
      accountId: identifierSchema,
      purchaseId: identifierSchema,
      priceUsd: z.number().int().min(1).max(10_000),
      promoCreditUsd: dollarsSchema,
    })
    .refine((action) => action.promoCreditUsd <= action.priceUsd, {
      path: ["promoCreditUsd"],
      error: "promotional credit cannot exceed the purchase price",
    }),
  z.strictObject({
    type: z.literal("refund"),
    accountId: identifierSchema,
    purchaseId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal("advance_days"),
    days: z.number().int().min(1).max(365),
  }),
]);

export type CommercePolicy = z.infer<typeof commercePolicySchema>;
export type CommerceGoal = z.infer<typeof commerceGoalSchema>;
export type CommerceAction = z.infer<typeof commerceActionSchema>;

export function parseCommercePolicy(value: unknown): CommercePolicy {
  return commercePolicySchema.parse(value);
}

export function parseCommerceGoal(value: unknown): CommerceGoal {
  return commerceGoalSchema.parse(value);
}

export function parseCommerceAction(value: unknown): CommerceAction {
  return commerceActionSchema.parse(value);
}
