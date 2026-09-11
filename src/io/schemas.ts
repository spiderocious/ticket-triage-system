import { z } from "zod";

const nonEmpty = z.string().min(1);

export const TicketSchema = z
  .object({
    ticket_id: nonEmpty,
    created_at: nonEmpty,
    channel: nonEmpty,
    language: nonEmpty,
    customer_tier: nonEmpty,
    subject: z.string(),
    message: z.string(),
  })
  .strict();

export const KbDocSchema = z
  .object({
    doc_id: nonEmpty,
    title: z.string(),
    category: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
  })
  .strict();

export const PolicySchema = z
  .object({
    allowed_decisions: z.array(nonEmpty).min(1),
    allowed_risk_levels: z.array(nonEmpty).min(1),
    required_output_fields: z.array(nonEmpty).min(1),
    rules: z.record(z.string(), z.boolean()),
  })
  .strict();

export const TicketsFileSchema = z.array(TicketSchema).min(1);
export const KbFileSchema = z.array(KbDocSchema).min(1);
