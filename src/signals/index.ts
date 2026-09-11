// CONTRACT — implemented by signals module. Pure and deterministic.
import type { KbDoc, Policy, RetrievalRecord, RoutingSignals, Ticket } from "../core/types.js";
import type { Result } from "../core/result.js";

/**
 * Derive the five booleans plus evidence for one ticket.
 * - matched_phrases: literal spans from subject + message (original casing preserved as found).
 * - triggered_rules: policy rule keys (only keys present in policy.rules and true) that the signals engage.
 * - relevant_doc_ids: subset of retrieval.retrieved doc_ids that back a signal.
 * - safe_for_auto_answer = !account && !security && !weak.
 * - retrieval_confidence: deterministic 0..1 from the retrieval scores.
 * Returns err(signal_untraceable) if any true boolean has no evidence entry.
 */
export function buildSignals(_ticket: Ticket, _retrieval: RetrievalRecord, _kb: KbDoc[], _policy: Policy): Result<RoutingSignals> {
  throw new Error("not implemented");
}
