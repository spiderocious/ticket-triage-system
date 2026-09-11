// CONTRACT — implemented by decide module. Pure. Imported by BOTH pipeline and validator.
import type { DecisionOutcome, Policy, RoutingSignals } from "../core/types.js";
import type { Result } from "../core/result.js";

/**
 * The ladder (first match wins):
 *  1 asks_for_account_specific_data -> refuse_and_redirect / high  (rules: privacy + accountData)
 *  2 is_security_sensitive          -> needs_human_review / high  (rules: security)
 *  3 evidence_is_weak_or_missing    -> needs_human_review / medium
 *  4 asks_for_guaranteed_timeline   -> auto_answer / medium        (rules: timeframes)
 *  5 otherwise                      -> auto_answer / low
 * policy_references is always non-empty: collect every rule engaged by any true signal (from signals.triggered_rules),
 * plus the row's own rules; when nothing else applies fall back to the first key in policy.rules.
 * Returns err(decision_not_allowed / risk_not_allowed) if the emitted values are not in the policy enums.
 */
export function decide(_signals: RoutingSignals, _policy: Policy): Result<DecisionOutcome> {
  throw new Error("not implemented");
}
