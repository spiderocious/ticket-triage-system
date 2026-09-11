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

/**
 * Used only to DETECT routing fields the model should never send. Kept separate from DraftSchema, which strips unknown
 * keys: stripping is the right behaviour for harmless extras, but a decision or risk level is not a harmless extra.
 */
export const ForbiddenFieldsSchema = z.object({
  ticket_id: z.string().optional(),
  decision: z.string().optional(),
  risk_level: z.string().optional(),
});
