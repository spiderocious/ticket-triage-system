import { describe, expect, it } from "vitest";
import { DECISION, RISK } from "../src/core/constants.js";
import type { DecisionOutcome, KbDoc, Policy, RoutingSignals, Ticket } from "../src/core/types.js";
import { checkDraft, checkGrounding, checkNextStep, checkPrivacyText, checkSecurityBypassText, checkTimelineText, templateDraft } from "../src/gate/index.js";
import type { DraftTicketContext } from "../src/llm/types.js";

const policy: Policy = {
  allowed_decisions: [DECISION.auto, DECISION.review, DECISION.refuse],
  allowed_risk_levels: [RISK.low, RISK.medium, RISK.high, RISK.critical],
  required_output_fields: ["ticket_id", "decision", "risk_level", "retrieved_doc_ids", "policy_references", "customer_response", "internal_reasoning_summary"],
  rules: {
    must_not_claim_account_specific_data: true,
    must_not_promise_unverified_timeframes: true,
    security_sensitive_topics_require_review: true,
    privacy_sensitive_requests_must_be_redirected: true,
  },
};

const doc: KbDoc = {
  doc_id: "kb_001",
  title: "Withdrawal review timeline",
  category: "payments",
  content: "Withdrawals may be delayed for manual review, verification checks, payment partner processing, or unusual account activity. Typical review windows are up to 24 hours, but exceptions exist.",
  tags: ["withdrawal", "manual review"],
};

const ticket: Ticket = { ticket_id: "t1", created_at: "2025-08-04T09:14:00Z", channel: "chat", language: "en", customer_tier: "standard", subject: "Why was my withdrawal delayed?", message: "It has been pending a while." };

function ctxFor(decision: string, overrides: Partial<RoutingSignals> = {}, retrieved = [{ doc, score: 0.63 }]): DraftTicketContext {
  const signals: RoutingSignals = {
    ticket_id: ticket.ticket_id,
    asks_for_account_specific_data: decision === DECISION.refuse,
    is_security_sensitive: false,
    asks_for_guaranteed_timeline: decision === DECISION.auto,
    evidence_is_weak_or_missing: false,
    safe_for_auto_answer: decision === DECISION.auto,
    matched_phrases: [],
    triggered_rules: [],
    relevant_doc_ids: retrieved.map((r) => r.doc.doc_id),
    retrieval_confidence: retrieved[0]?.score ?? 0,
    ...overrides,
  };
  const outcome: DecisionOutcome = {
    decision,
    risk_level: decision === DECISION.auto ? RISK.medium : RISK.high,
    policy_references: ["must_not_promise_unverified_timeframes"],
    rule_fired: "test",
    decision_without_evidence_fallback: decision,
  };
  return { ticket, retrieved, signals, outcome };
}

describe("privacy validator", () => {
  it("flags currency figures", () => expect(checkPrivacyText("Your balance is $1,250.00 today.").length).toBeGreaterThan(0));
  it("flags worded currency", () => expect(checkPrivacyText("You have 400 USD available.").length).toBeGreaterThan(0));
  it("flags transaction listings", () => expect(checkPrivacyText("Your last 3 transactions are: coffee, rent, fuel.").length).toBeGreaterThan(0));
  it("flags long digit runs that look like account numbers", () => expect(checkPrivacyText("Account 123456789 is fine.").length).toBeGreaterThan(0));
  it("passes a safe refusal", () => expect(checkPrivacyText("We cannot share account details here. Please sign in to the app.")).toEqual([]));
});

describe("timeline validator", () => {
  it("passes a hedged range drawn from the knowledge base", () =>
    expect(checkTimelineText("Reviews typically take up to 24 hours, but exceptions exist.")).toEqual([]));
  it("flags an unhedged promise", () => expect(checkTimelineText("Your withdrawal will complete within 2 hours.").length).toBeGreaterThan(0));
  it("flags a guarantee", () => expect(checkTimelineText("We guarantee it lands today.").length).toBeGreaterThan(0));
  it("flags a named-day promise", () => expect(checkTimelineText("It will be done by Tuesday.").length).toBeGreaterThan(0));
});

describe("security bypass validator", () => {
  it("flags disabling 2FA", () => expect(checkSecurityBypassText("We have disabled 2FA for you.").length).toBeGreaterThan(0));
  it("flags skipping verification", () => expect(checkSecurityBypassText("You can get in without verification.").length).toBeGreaterThan(0));
  it("passes a compliant escalation", () => expect(checkSecurityBypassText("Our identity verification team will contact you.")).toEqual([]));
});

describe("next step and grounding", () => {
  it("flags a refusal with no next step", () => expect(checkNextStep("We cannot help with that.").length).toBeGreaterThan(0));
  it("accepts a refusal that points somewhere", () => expect(checkNextStep("Please sign in to your account to see it.")).toEqual([]));
  it("flags an ungrounded auto answer", () => {
    const draft = { ticket_id: "t1", customer_response: "Hello there friend, hope your afternoon is going nicely indeed.", internal_reasoning_summary: "x".repeat(25) };
    expect(checkGrounding(draft, ctxFor(DECISION.auto)).length).toBeGreaterThan(0);
  });
});

describe("checkDraft", () => {
  it("rejects a short response", () => {
    const v = checkDraft({ ticket_id: "t1", customer_response: "Too short.", internal_reasoning_summary: "also short" }, ctxFor(DECISION.auto), policy);
    expect(v.some((x) => x.startsWith("length:"))).toBe(true);
  });
  it("rejects a balance disclosure even when the ticket did not ask", () => {
    const v = checkDraft({ ticket_id: "t1", customer_response: "Withdrawals are reviewed manually. Your balance is $40.00 by the way, thanks for waiting.", internal_reasoning_summary: "Decision auto_answer for the withdrawal query." }, ctxFor(DECISION.auto), policy);
    expect(v.some((x) => x.startsWith("privacy:"))).toBe(true);
  });
});

describe("templateDraft", () => {
  for (const decision of [DECISION.auto, DECISION.review, DECISION.refuse]) {
    it(`passes the gate for ${decision} with documents`, () => {
      const ctx = ctxFor(decision);
      expect(checkDraft(templateDraft(ctx), ctx, policy)).toEqual([]);
    });
    it(`passes the gate for ${decision} with no documents`, () => {
      const ctx = ctxFor(decision, { evidence_is_weak_or_missing: true, retrieval_confidence: 0, relevant_doc_ids: [] }, []);
      expect(checkDraft(templateDraft(ctx), ctx, policy)).toEqual([]);
    });
  }
  it("marks a security escalation with the verification team", () => {
    const ctx = ctxFor(DECISION.review, { is_security_sensitive: true });
    expect(templateDraft(ctx).customer_response).toContain("identity verification team");
  });
});
