import { z } from "zod";

/**
 * Deliberately NO decision / risk_level fields: the model cannot supply what it has no slot for.
 * Those values are computed by deterministic code and are merged in by the caller.
 */
export const DraftItemSchema = z.object({
  ticket_id: z.string(),
  customer_response: z.string(),
  internal_reasoning_summary: z.string(),
});

export const DraftSchema = z.object({
  drafts: z.array(DraftItemSchema),
});
