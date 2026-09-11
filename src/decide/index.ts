import { DECISION, RISK, RULE } from "../core/constants.js";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok, type Result } from "../core/result.js";
import type { DecisionOutcome, Policy, RoutingSignals } from "../core/types.js";

interface Row {
  label: string;
  when: (s: RoutingSignals) => boolean;
  decision: string;
  risk: string;
  rules: string[];
}

/**
 * The ladder. First match wins; ORDER IS LOAD-BEARING — safety rows sit above the permissive ones so a mixed-intent
 * ticket resolves to the restrictive branch. Do not reorder or alphabetise.
 */
export const LADDER: readonly Row[] = [
  { label: "ladder_1_account_data", when: (s) => s.asks_for_account_specific_data, decision: DECISION.refuse, risk: RISK.high, rules: [RULE.privacy, RULE.accountData] },
  { label: "ladder_2_security", when: (s) => s.is_security_sensitive, decision: DECISION.review, risk: RISK.high, rules: [RULE.security] },
  { label: "ladder_3_weak_evidence", when: (s) => s.evidence_is_weak_or_missing, decision: DECISION.review, risk: RISK.medium, rules: [] },
  { label: "ladder_4_timeline", when: (s) => s.asks_for_guaranteed_timeline, decision: DECISION.auto, risk: RISK.medium, rules: [RULE.timeframes] },
  { label: "ladder_5_default", when: () => true, decision: DECISION.auto, risk: RISK.low, rules: [] },
];

function firstRow(signals: RoutingSignals, skipWeak: boolean): Row {
  for (const row of LADDER) {
    if (skipWeak && row.label === "ladder_3_weak_evidence") continue;
    if (row.when(signals)) return row;
  }
  return LADDER[LADDER.length - 1] as Row;
}

/** Pure. Imported by BOTH the pipeline and the validator so drift between them is impossible. */
export function decide(signals: RoutingSignals, policy: Policy): Result<DecisionOutcome> {
  const row = firstRow(signals, false);
  const without = firstRow(signals, true);
  if (!policy.allowed_decisions.includes(row.decision)) {
    return err(appError(ERR.decision_not_allowed, `${signals.ticket_id}: ${row.decision}`));
  }
  if (!policy.allowed_risk_levels.includes(row.risk)) {
    return err(appError(ERR.risk_not_allowed, `${signals.ticket_id}: ${row.risk}`));
  }
  const wanted = new Set([...signals.triggered_rules, ...row.rules]);
  let policy_references = Object.keys(policy.rules).filter((k) => policy.rules[k] === true && wanted.has(k));
  if (policy_references.length === 0) {
    const first = Object.keys(policy.rules)[0];
    policy_references = first ? [first] : ["policy"];
  }
  return ok({
    decision: row.decision,
    risk_level: row.risk,
    policy_references,
    rule_fired: row.label,
    decision_without_evidence_fallback: without.decision,
  });
}
