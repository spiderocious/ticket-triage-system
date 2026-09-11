import { RULE, WEAK_EVIDENCE_FLOOR } from "../core/constants.js";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok, type Result } from "../core/result.js";
import type { KbDoc, Policy, RetrievalRecord, RoutingSignals, Ticket } from "../core/types.js";
import { assessEvidence } from "./evidence.js";
import { detectAccountData, detectSecurity, detectTimeline, detectUrgency } from "./rules.js";

export { assessEvidence } from "./evidence.js";
export * from "./rules.js";

const SECURITY_CATEGORIES = new Set(["security", "account security", "authentication"]);
const PRIVACY_CATEGORIES = new Set(["privacy", "data", "data protection"]);
const PAYMENT_CATEGORIES = new Set(["payments", "payment", "withdrawals", "billing", "transactions"]);

function activeRules(policy: Policy, keys: string[]): string[] {
  return keys.filter((k) => policy.rules[k] === true);
}

/**
 * Derive the five booleans plus evidence for one ticket. Pure and deterministic.
 * Evidence contract: every true boolean among the first four must be backed by a matched phrase, a triggered rule, or a
 * relevant doc id. `evidence_is_weak_or_missing` is backed by `retrieval_confidence`, which the validator re-derives from
 * retrieval_results.json (there is no literal span to cite when nothing was retrieved).
 */
export function buildSignals(ticket: Ticket, retrieval: RetrievalRecord, kb: KbDoc[], policy: Policy): Result<RoutingSignals> {
  const text = `${ticket.subject} ${ticket.message}`;
  const byId = new Map(kb.map((d) => [d.doc_id, d]));
  const retrievedDocs = retrieval.retrieved.map((r) => ({ r, doc: byId.get(r.doc_id) })).filter((x) => x.doc !== undefined);
  const top = retrievedDocs[0];
  const topCategory = top?.doc?.category.toLowerCase() ?? "";

  const account = detectAccountData(text);
  const security = detectSecurity(text);
  const timeline = detectTimeline(text);
  const urgency = detectUrgency(text);
  const evidence = assessEvidence(retrieval);

  const topIsSecurity = top !== undefined && top.r.score >= WEAK_EVIDENCE_FLOOR && SECURITY_CATEGORIES.has(topCategory);
  const asks_for_account_specific_data = account.matched;
  const is_security_sensitive = security.matched || topIsSecurity;
  const asks_for_guaranteed_timeline = timeline.matched;
  const evidence_is_weak_or_missing = evidence.weak;
  const safe_for_auto_answer = !asks_for_account_specific_data && !is_security_sensitive && !evidence_is_weak_or_missing;

  const matched_phrases = [...new Set([...account.spans, ...security.spans, ...timeline.spans, ...urgency.spans])].sort(
    (a, b) => text.indexOf(a) - text.indexOf(b),
  );

  const triggered_rules = [
    ...(asks_for_account_specific_data ? activeRules(policy, [RULE.accountData, RULE.privacy]) : []),
    ...(is_security_sensitive ? activeRules(policy, [RULE.security]) : []),
    ...(asks_for_guaranteed_timeline ? activeRules(policy, [RULE.timeframes]) : []),
  ];

  const relevant = new Set<string>();
  for (const { r, doc } of retrievedDocs) {
    const cat = doc?.category.toLowerCase() ?? "";
    if (is_security_sensitive && SECURITY_CATEGORIES.has(cat)) relevant.add(r.doc_id);
    if (asks_for_account_specific_data && PRIVACY_CATEGORIES.has(cat)) relevant.add(r.doc_id);
    if (asks_for_guaranteed_timeline && PAYMENT_CATEGORIES.has(cat)) relevant.add(r.doc_id);
  }
  if (top && !evidence.weak) relevant.add(top.r.doc_id);
  if (evidence.weak) for (const { r } of retrievedDocs) relevant.add(r.doc_id);
  const relevant_doc_ids = retrieval.retrieved.map((r) => r.doc_id).filter((id) => relevant.has(id));

  const hasEvidence = (spans: string[], docBacked: boolean) => spans.length > 0 || docBacked;
  const checks: Array<[string, boolean, boolean]> = [
    ["asks_for_account_specific_data", asks_for_account_specific_data, hasEvidence(account.spans, false)],
    ["is_security_sensitive", is_security_sensitive, hasEvidence(security.spans, topIsSecurity && relevant.has(top.r.doc_id))],
    ["asks_for_guaranteed_timeline", asks_for_guaranteed_timeline, hasEvidence(timeline.spans, false)],
  ];
  for (const [name, flag, backed] of checks) {
    if (flag && !backed) return err(appError(ERR.signal_untraceable, `${ticket.ticket_id}: ${name}`));
  }

  return ok({
    ticket_id: ticket.ticket_id,
    asks_for_account_specific_data,
    is_security_sensitive,
    asks_for_guaranteed_timeline,
    evidence_is_weak_or_missing,
    safe_for_auto_answer,
    matched_phrases,
    triggered_rules: [...new Set(triggered_rules)],
    relevant_doc_ids,
    retrieval_confidence: evidence.confidence,
  });
}
