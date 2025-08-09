import z from "zod";

export const couponSchema = z.object({
  code: z.string().min(3).max(32),
  discount: z.number().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
  redeemable: z.boolean(),
  redeemed: z.boolean().default(false),
});
