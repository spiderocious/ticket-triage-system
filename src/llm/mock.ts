import { DECISION, MOCK_MODEL_NAME, MOCK_PROVIDER_NAME } from "../core/constants.js";
import { ok } from "../core/result.js";
import type { Result } from "../core/result.js";
import type { Draft } from "../core/types.js";
import type { BuiltPrompt, DraftRequest, DraftTicketContext, LlmProvider } from "./types.js";

/** Matches a standalone numeric duration ("48 hours", "3-5 days"), used to strip anything not quoted verbatim from a doc. */
const NUMERIC_DURATION = /\b\d+(?:\s*[-–]\s*\d+)?\s*(hours?|days?|minutes?|weeks?|business days?)\b/gi;

function cleanSubject(subject: string): string {
  return subject.trim().replace(/\?+$/, "").trim();
}

/** First two sentences of a document, rejoined. Keeps the doc's own hedged wording intact. */
function firstSentences(content: string, count: number): string {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.slice(0, count).join(" ");
}

/** A duration is only allowed to survive if it came from the doc AND the doc hedged it. */
function stripUnhedgedDurations(sentence: string): string {
  const hedged = /typically|up to/i.test(sentence);
  if (hedged) return sentence;
  return sentence.replace(NUMERIC_DURATION, "some time").replace(/\s{2,}/g, " ").trim();
}

function autoAnswerText(ctx: DraftTicketContext): string {
  const subject = cleanSubject(ctx.ticket.subject).toLowerCase();
  const top = ctx.retrieved[0];
  const grounded = top === undefined ? "" : stripUnhedgedDurations(firstSentences(top.doc.content, 2));
  const opening = `Thanks for getting in touch about ${subject}. `;
  const body = grounded.length > 0 ? `${grounded} ` : "";
  const close =
    "We have not confirmed the status of your specific case here, so we cannot give an exact completion time. If it has not resolved, please reply and our team will look into it further.";
  return `${opening}${body}${close}`;
}

function reviewText(ctx: DraftTicketContext): string {
  const subject = cleanSubject(ctx.ticket.subject);
  const security = ctx.signals.is_security_sensitive;
  const team = security ? "identity verification team" : "support specialists";
  const guard = security
    ? "For your protection we cannot change security settings over chat or email without completing the documented verification steps. "
    : "";
  return (
    `Thanks for contacting us about ${subject}. ` +
    `This request needs to be handled by our ${team}, so we have routed it for review. ` +
    guard +
    "You will hear back from our team with the next steps. Please do not share codes or passwords with anyone."
  );
}

function refuseText(): string {
  return (
    "Thanks for reaching out. We are not able to share account-specific information such as balances or transaction history through this channel. " +
    "Please sign in to your account in the app or on the website, where this information is available securely. " +
    "If you cannot sign in, reply here and our team will help you regain access."
  );
}

function customerResponseFor(ctx: DraftTicketContext): string {
  switch (ctx.outcome.decision) {
    case DECISION.auto:
      return autoAnswerText(ctx);
    case DECISION.review:
      return reviewText(ctx);
    case DECISION.refuse:
      return refuseText();
    default:
      return reviewText(ctx);
  }
}

function internalSummaryFor(ctx: DraftTicketContext): string {
  const docIds = ctx.retrieved.map((r) => r.doc.doc_id);
  const docs = docIds.length > 0 ? docIds.join(", ") : "none";
  const refs = ctx.outcome.policy_references.join(", ");
  return (
    `Decision ${ctx.outcome.decision} (risk ${ctx.outcome.risk_level}) set by ${ctx.outcome.rule_fired}. ` +
    `Policy references: ${refs}. Top documents: ${docs}. ` +
    `Retrieval confidence ${String(ctx.signals.retrieval_confidence)}.`
  );
}

/** Pads a string that fell under a minimum length, so mock output always satisfies the same floors the real schema enforces. */
function atLeast(text: string, min: number, filler: string): string {
  let out = text;
  while (out.length < min) out = `${out} ${filler}`.trim();
  return out;
}

/** Deterministic, network-free provider. Same request => byte-identical drafts. */
export class MockProvider implements LlmProvider {
  readonly name = MOCK_PROVIDER_NAME;
  readonly model = MOCK_MODEL_NAME;

  draft(_prompt: BuiltPrompt, req: DraftRequest): Promise<Result<Draft[]>> {
    const notes = req.repairNotes;
    const wanted = notes !== undefined && Object.keys(notes).length > 0 ? new Set(Object.keys(notes)) : null;
    const contexts = wanted === null ? req.contexts : req.contexts.filter((c) => wanted.has(c.ticket.ticket_id));

    const drafts: Draft[] = contexts.map((ctx) => ({
      ticket_id: ctx.ticket.ticket_id,
      customer_response: atLeast(
        customerResponseFor(ctx),
        40,
        "Please reply to this message and our team will continue helping you.",
      ),
      internal_reasoning_summary: atLeast(internalSummaryFor(ctx), 20, "No further detail available."),
    }));

    return Promise.resolve(ok(drafts));
  }
}
