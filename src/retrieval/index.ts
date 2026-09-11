// CONTRACT — implemented by retrieval module. Pure and deterministic.
import type { Inputs, RetrievalRecord } from "../core/types.js";

/**
 * Retrieve top-k docs for every ticket, in ticket input order.
 * Sorted score desc, then doc_id asc. Scores rounded to SCORE_PRECISION. Every kept doc has >=1 match_reason.
 * Docs with score 0 and no reasons are dropped; `retrieved` may be empty for a ticket.
 */
export function retrieveAll(_inputs: Inputs, _topK: number): RetrievalRecord[] {
  throw new Error("not implemented");
}
