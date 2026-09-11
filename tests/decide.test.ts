import { describe, expect, it } from "vitest";
import { DECISION, RISK } from "../src/core/constants.js";
import type { Policy, RoutingSignals } from "../src/core/types.js";
import { decide } from "../src/decide/index.js";

const policy: Policy = {
  allowed_decisions: [DECISION.auto, DECISION.review, DECISION.refuse],
  allowed_risk_levels: [RISK.low, RISK.medium, RISK.high, RISK.critical],
  required_output_fields: ["ticket_id", "decision"],
  rules: {
    must_not_claim_account_specific_data: true,
    must_not_promise_unverified_timeframes: true,
    security_sensitive_topics_require_review: true,
    privacy_sensitive_requests_must_be_redirected: true,
  },
};

function sig(over: Partial<RoutingSignals> = {}): RoutingSignals {
  return {
    ticket_id: "t",
    asks_for_account_specific_data: false,
    is_security_sensitive: false,
    asks_for_guaranteed_timeline: false,
    evidence_is_weak_or_missing: false,
    safe_for_auto_answer: true,
    matched_phrases: [],
    triggered_rules: [],
    relevant_doc_ids: ["kb_001"],
    retrieval_confidence: 0.6,
    ...over,
  };
}
const unwrapOk = (r: ReturnType<typeof decide>) => {
  if (!r.ok) throw new Error(r.error.identity);
  return r.value;
};

describe("the ladder", () => {
  it("row 1: account data refuses", () => {
    const d = unwrapOk(decide(sig({ asks_for_account_specific_data: true, triggered_rules: ["must_not_claim_account_specific_data"] }), policy));
    expect([d.decision, d.risk_level, d.rule_fired]).toEqual([DECISION.refuse, RISK.high, "ladder_1_account_data"]);
  });
  it("row 2: security escalates", () => {
    const d = unwrapOk(decide(sig({ is_security_sensitive: true }), policy));
    expect([d.decision, d.risk_level]).toEqual([DECISION.review, RISK.high]);
  });
  it("row 3: weak evidence escalates at medium risk", () => {
    const d = unwrapOk(decide(sig({ evidence_is_weak_or_missing: true, retrieval_confidence: 0.02 }), policy));
    expect([d.decision, d.risk_level, d.rule_fired]).toEqual([DECISION.review, RISK.medium, "ladder_3_weak_evidence"]);
  });
  it("row 4: a timeline question still auto-answers, at medium risk", () => {
    const d = unwrapOk(decide(sig({ asks_for_guaranteed_timeline: true, triggered_rules: ["must_not_promise_unverified_timeframes"] }), policy));
    expect([d.decision, d.risk_level]).toEqual([DECISION.auto, RISK.medium]);
    expect(d.policy_references).toContain("must_not_promise_unverified_timeframes");
  });
  it("row 5: the permissive default", () => {
    const d = unwrapOk(decide(sig(), policy));
    expect([d.decision, d.risk_level]).toEqual([DECISION.auto, RISK.low]);
  });
});

describe("ordering and safety", () => {
  it("resolves mixed intent to the most restrictive branch", () => {
    const d = unwrapOk(decide(sig({ asks_for_account_specific_data: true, asks_for_guaranteed_timeline: true, is_security_sensitive: true }), policy));
    expect(d.decision).toBe(DECISION.refuse);
  });
  it("prefers escalation over auto-answering when evidence is weak", () => {
    const d = unwrapOk(decide(sig({ asks_for_guaranteed_timeline: true, evidence_is_weak_or_missing: true }), policy));
    expect(d.decision).toBe(DECISION.review);
    expect(d.decision_without_evidence_fallback).toBe(DECISION.auto);
  });
  it("always produces at least one policy reference", () => {
    expect(unwrapOk(decide(sig(), policy)).policy_references.length).toBeGreaterThan(0);
  });
  it("works with a policy whose rule keys differ", () => {
    const other: Policy = { ...policy, rules: { some_other_rule: true } };
    expect(unwrapOk(decide(sig(), other)).policy_references).toEqual(["some_other_rule"]);
  });
  it("rejects a decision the policy does not allow", () => {
    const restricted: Policy = { ...policy, allowed_decisions: [DECISION.auto] };
    const r = decide(sig({ is_security_sensitive: true }), restricted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.identity).toBe("decision_not_allowed");
  });
  it("rejects a risk level the policy does not allow", () => {
    const restricted: Policy = { ...policy, allowed_risk_levels: [RISK.low] };
    const r = decide(sig({ is_security_sensitive: true }), restricted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.identity).toBe("risk_not_allowed");
  });
});
