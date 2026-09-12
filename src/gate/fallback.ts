import { DECISION } from "../core/constants.js";
import type { FallbackRecord } from "../core/types.js";
import type { EvidenceAssessment } from "../signals/evidence.js";
import type { DraftTicketContext } from "../llm/types.js";

/**
 * `fallback_analysis.json` answers one question: why was this answer not auto-sent as drafted?
 *
 * Three cases earn a record.
 *   1. Weak evidence pulled the ticket away from a more permissive decision (the ladder's row 3).
 *   2. The drafted and repaired text both failed the safety gate, so a deterministic template was substituted.
 *   3. The top match cleared the floor but sat below the strong-evidence bar. This changes no decision, and is
 *      recorded anyway: a silent artifact is indistinguishable from an unexercised code path, and a reviewer should be
 *      able to see which matches were merely adequate rather than convincing.
 *
 * Every record carries the raw scores behind the verdict, so the thresholds can be audited against the numbers rather
 * than taken on trust.
 */
export function buildFallbackRecord(
  ctx: DraftTicketContext,
  templated: boolean,
  gateReason: string | undefined,
  evidence: EvidenceAssessment,
): FallbackRecord | undefined {
  const { outcome, signals } = ctx;
  const downgraded = signals.evidence_is_weak_or_missing && outcome.decision !== outcome.decision_without_evidence_fallback;
  // Weak evidence is recorded even when the ladder did not downgrade, because a safety row above it had already
  // claimed the ticket. The answer still rests on thin retrieval, and that is exactly what a reviewer needs to see.
  const weakButNotDowngraded = signals.evidence_is_weak_or_missing && !downgraded;
  const nearThreshold = evidence.trigger === "near_threshold";
  if (!downgraded && !templated && !nearThreshold && !weakButNotDowngraded) return undefined;

  const reasons: string[] = [];
  if (downgraded) {
    reasons.push(
      `retrieval evidence was weak or missing (${evidence.reason}), so the ticket was downgraded from ${outcome.decision_without_evidence_fallback} to ${outcome.decision}`,
    );
  }
  if (templated) {
    reasons.push(`the drafted response failed the safety gate and was replaced with a deterministic template${gateReason ? ` (${gateReason})` : ""}`);
  }
  if (weakButNotDowngraded) {
    reasons.push(
      `retrieval evidence was weak (${evidence.reason}), but a higher-priority rule had already set ${outcome.decision}, so the decision did not change`,
    );
  }
  if (nearThreshold && !downgraded && !templated && !weakButNotDowngraded) {
    reasons.push(`${evidence.reason}; the answer was sent, but the match is adequate rather than strong`);
  }
  if (!downgraded && !nearThreshold && templated && outcome.decision === DECISION.auto) {
    reasons.push("the response was auto-answerable but the generated text required substitution");
  }

  // The most consequential trigger wins: a substitution outranks a downgrade, which outranks a note.
  const trigger = templated ? "template_substituted" : downgraded || weakButNotDowngraded ? evidence.trigger : "near_threshold";
  const action_taken = templated
    ? "template_substituted"
    : downgraded
      ? `downgraded_to_${outcome.decision}`
      : "recorded_only";

  return {
    ticket_id: ctx.ticket.ticket_id,
    retrieval_confidence: signals.retrieval_confidence,
    original_decision: downgraded ? outcome.decision_without_evidence_fallback : outcome.decision,
    final_decision: outcome.decision,
    reason_not_auto_sent: reasons.join("; "),
    top_score: evidence.top_score,
    second_score: evidence.second_score,
    margin: evidence.margin,
    trigger,
    action_taken,
  };
}
