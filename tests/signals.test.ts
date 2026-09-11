import { describe, expect, it } from "vitest";
import { unwrap } from "../src/core/result.js";
import type { KbDoc, Policy, RetrievalRecord, Ticket } from "../src/core/types.js";
import { loadInputs } from "../src/io/load.js";
import { retrieveAll } from "../src/retrieval/index.js";
import { assessEvidence, buildSignals, detectAccountData, detectSecurity, detectTimeline, detectUrgency } from "../src/signals/index.js";

const kb: KbDoc[] = [
  { doc_id: "kb_001", title: "Withdrawal review timeline", category: "payments", content: "Withdrawals may be delayed for manual review. Typical review windows are up to 24 hours, but exceptions exist.", tags: ["withdrawal"] },
  { doc_id: "kb_002", title: "2FA reset procedure", category: "security", content: "Route lost 2FA device cases to identity verification.", tags: ["2fa"] },
  { doc_id: "kb_003", title: "Account data access policy", category: "privacy", content: "Never provide balance or transaction history outside authenticated surfaces.", tags: ["balance"] },
];
const policy: Policy = {
  allowed_decisions: ["auto_answer", "needs_human_review", "refuse_and_redirect"],
  allowed_risk_levels: ["low", "medium", "high", "critical"],
  required_output_fields: ["ticket_id", "decision"],
  rules: { must_not_claim_account_specific_data: true, must_not_promise_unverified_timeframes: true, security_sensitive_topics_require_review: true, privacy_sensitive_requests_must_be_redirected: true },
};
const ticket = (subject: string, message: string): Ticket => ({ ticket_id: "t", created_at: "2025-08-04T09:00:00Z", channel: "chat", language: "en", customer_tier: "standard", subject, message });
const retrieval = (docs: Array<[string, number]>): RetrievalRecord => ({ ticket_id: "t", retrieved: docs.map(([doc_id, score]) => ({ doc_id, score, match_reasons: ["test"] })) });

describe("phrase detectors", () => {
  it("catches a direct balance request", () => expect(detectAccountData("Tell me my account balance").matched).toBe(true));
  it("catches an indirectly phrased privacy request", () => expect(detectAccountData("Can you confirm how much came into my account last week?").matched).toBe(true));
  it("catches a statement request", () => expect(detectAccountData("Could you email me a statement of my transactions?").matched).toBe(true));
  it("ignores an ordinary withdrawal question", () => expect(detectAccountData("Why is my withdrawal taking so long?").matched).toBe(false));
  it("catches 2FA wording", () => expect(detectSecurity("I need help resetting 2FA").matched).toBe(true));
  it("catches a lost device", () => expect(detectSecurity("I no longer have access to my phone").matched).toBe(true));
  it("catches timeline questions", () => expect(detectTimeline("When will it complete?").matched).toBe(true));
  it("catches urgency language", () => expect(detectUrgency("This is urgent, I need it ASAP").matched).toBe(true));
  it("returns the literal span as written", () => expect(detectSecurity("Please reset my 2FA").spans.some((s) => s.includes("2FA"))).toBe(true));
});

describe("evidence assessment", () => {
  it("marks an empty retrieval weak with zero confidence", () => {
    const e = assessEvidence(retrieval([]));
    expect([e.weak, e.confidence]).toEqual([true, 0]);
  });
  it("marks a below-floor top score weak", () => expect(assessEvidence(retrieval([["kb_001", 0.05]])).weak).toBe(true));
  it("marks two near-identical mediocre scores ambiguous", () => expect(assessEvidence(retrieval([["kb_001", 0.2], ["kb_002", 0.18]])).weak).toBe(true));
  it("accepts a clear winner", () => expect(assessEvidence(retrieval([["kb_001", 0.63], ["kb_002", 0.08]])).weak).toBe(false));
});

describe("buildSignals", () => {
  it("flags a security ticket and cites the security document", () => {
    const s = unwrap(buildSignals(ticket("Reset 2FA", "I lost my phone and need 2FA reset"), retrieval([["kb_002", 0.64]]), kb, policy));
    expect(s.is_security_sensitive).toBe(true);
    expect(s.relevant_doc_ids).toContain("kb_002");
    expect(s.triggered_rules).toContain("security_sensitive_topics_require_review");
    expect(s.safe_for_auto_answer).toBe(false);
  });
  it("flags a security ticket carrying urgency language, keeping both spans", () => {
    const s = unwrap(buildSignals(ticket("URGENT 2FA off", "This is urgent, disable 2FA immediately"), retrieval([["kb_002", 0.6]]), kb, policy));
    expect(s.is_security_sensitive).toBe(true);
    expect(s.matched_phrases.some((p) => /urgent/i.test(p))).toBe(true);
  });
  it("flags account data on indirect phrasing", () => {
    const s = unwrap(buildSignals(ticket("Quick question", "How much came into my account last week?"), retrieval([["kb_003", 0.4]]), kb, policy));
    expect(s.asks_for_account_specific_data).toBe(true);
    expect(s.triggered_rules).toContain("privacy_sensitive_requests_must_be_redirected");
  });
  it("treats a security-category top hit as security-sensitive even without a phrase", () => {
    const s = unwrap(buildSignals(ticket("Odd login", "Something looks off with my sign in"), retrieval([["kb_002", 0.5]]), kb, policy));
    expect(s.is_security_sensitive).toBe(true);
    expect(s.relevant_doc_ids).toContain("kb_002");
  });
  it("marks a mixed-intent ticket with both flags", () => {
    const s = unwrap(buildSignals(ticket("Withdrawal and balance", "Why is my withdrawal delayed, and what is my balance?"), retrieval([["kb_001", 0.5], ["kb_003", 0.2]]), kb, policy));
    expect([s.asks_for_account_specific_data, s.asks_for_guaranteed_timeline]).toEqual([true, false]);
  });
  it("gives every true boolean supporting evidence", () => {
    const s = unwrap(buildSignals(ticket("Tell me my balance", "What is my account balance?"), retrieval([["kb_003", 0.66]]), kb, policy));
    expect(s.matched_phrases.length + s.triggered_rules.length + s.relevant_doc_ids.length).toBeGreaterThan(0);
  });
  it("only reports rules the policy actually declares", () => {
    const sparse: Policy = { ...policy, rules: { security_sensitive_topics_require_review: true } };
    const s = unwrap(buildSignals(ticket("Balance", "What is my balance?"), retrieval([["kb_003", 0.6]]), kb, sparse));
    expect(s.triggered_rules).toEqual([]);
  });
});

describe("signals on the real sample data", () => {
  it("produces the expected five booleans per sample ticket", async () => {
    const inputs = unwrap(await loadInputs({ tickets: "tickets.json", kb: "knowledge_base.json", policy: "response_policy.json" }));
    const ret = retrieveAll(inputs, 3);
    const flags = inputs.tickets.map((t, i) => {
      const s = unwrap(buildSignals(t, ret[i]!, inputs.kb, inputs.policy));
      return [s.asks_for_account_specific_data, s.is_security_sensitive, s.asks_for_guaranteed_timeline, s.evidence_is_weak_or_missing];
    });
    expect(flags[0]).toEqual([false, false, true, false]);
    expect(flags[1]).toEqual([false, true, false, false]);
    expect(flags[2]).toEqual([true, false, false, false]);
  });
});
