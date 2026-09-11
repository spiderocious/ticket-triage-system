import { DECISION } from "../core/constants.js";
import type { FallbackRecord } from "../core/types.js";
import type { DraftTicketContext } from "../llm/types.js";

/**
 * A ticket earns a fallback record when weak evidence pulled it away from auto-answering, or when the safety gate
 * forced a deterministic template. Both are cases where the answer was not auto-sent as drafted.
 */
export function buildFallbackRecord(ctx: DraftTicketContext, templated: boolean, gateReason: string | undefined): FallbackRecord | undefined {
  const { outcome, signals } = ctx;
  const downgraded = signals.evidence_is_weak_or_missing && outcome.decision !== outcome.decision_without_evidence_fallback;
  if (!downgraded && !templated) return undefined;

  const reasons: string[] = [];
  if (downgraded) reasons.push(`retrieval evidence was weak or missing (confidence ${signals.retrieval_confidence}), so the ticket was downgraded from ${outcome.decision_without_evidence_fallback} to ${outcome.decision}`);
  if (templated) reasons.push(`the drafted response failed the safety gate and was replaced with a deterministic template${gateReason ? ` (${gateReason})` : ""}`);
  if (!downgraded && outcome.decision === DECISION.auto) reasons.push("the response was auto-answerable but the generated text required substitution");

  return {
    ticket_id: ctx.ticket.ticket_id,
    retrieval_confidence: signals.retrieval_confidence,
    original_decision: downgraded ? outcome.decision_without_evidence_fallback : outcome.decision,
    final_decision: outcome.decision,
    reason_not_auto_sent: reasons.join("; "),
  };
}
