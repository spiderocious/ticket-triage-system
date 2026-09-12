import { describe, expect, it } from "vitest";
import { DECISION, RISK } from "../src/core/constants.js";
import type { DecisionOutcome, KbDoc, RetrievalRecord, RoutingSignals, Ticket } from "../src/core/types.js";
import { buildFallbackRecord } from "../src/gate/index.js";
import { assessEvidence } from "../src/signals/evidence.js";
import type { DraftTicketContext } from "../src/llm/types.js";

const doc: KbDoc = {
  doc_id: "kb_001",
  title: "Withdrawal review timeline",
  category: "payments",
  content: "Withdrawals may be delayed for manual review. Typical review windows are up to 24 hours, but exceptions exist.",
  tags: ["withdrawal"],
};
const ticket: Ticket = { ticket_id: "t1", created_at: "2025-08-04T09:00:00Z", channel: "chat", language: "en", customer_tier: "standard", subject: "s", message: "m" };

const retrieval = (scores: number[]): RetrievalRecord => ({
  ticket_id: "t1",
  retrieved: scores.map((score, i) => ({ doc_id: `kb_00${String(i + 1)}`, score, match_reasons: ["test"] })),
});

function ctxFor(opts: { decision: string; wouldHaveBeen?: string; weak?: boolean; confidence?: number }): DraftTicketContext {
  const signals: RoutingSignals = {
    ticket_id: "t1",
    asks_for_account_specific_data: false,
    is_security_sensitive: false,
    asks_for_guaranteed_timeline: false,
    evidence_is_weak_or_missing: opts.weak ?? false,
    safe_for_auto_answer: !(opts.weak ?? false),
    matched_phrases: [],
    triggered_rules: [],
    relevant_doc_ids: ["kb_001"],
    retrieval_confidence: opts.confidence ?? 0.6,
  };
  const outcome: DecisionOutcome = {
    decision: opts.decision,
    risk_level: RISK.medium,
    policy_references: ["must_not_promise_unverified_timeframes"],
    rule_fired: "test",
    decision_without_evidence_fallback: opts.wouldHaveBeen ?? opts.decision,
  };
  return { ticket, retrieved: [{ doc, score: opts.confidence ?? 0.6 }], signals, outcome };
}

describe("fallback records fire on weak evidence", () => {
  it("records a ticket downgraded because the top score fell below the floor", () => {
    const ev = assessEvidence(retrieval([0.07, 0.05]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.review, wouldHaveBeen: DECISION.auto, weak: true, confidence: 0.07 }), false, undefined, ev);
    expect(rec).toBeDefined();
    expect(rec?.trigger).toBe("below_floor");
    expect(rec?.action_taken).toBe("downgraded_to_needs_human_review");
    expect(rec?.original_decision).toBe(DECISION.auto);
    expect(rec?.final_decision).toBe(DECISION.review);
    expect(rec?.reason_not_auto_sent).toMatch(/weak or missing/);
  });

  it("records a ticket downgraded because the top two scores were ambiguous", () => {
    const ev = assessEvidence(retrieval([0.2, 0.18]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.review, wouldHaveBeen: DECISION.auto, weak: true, confidence: 0.2 }), false, undefined, ev);
    expect(rec?.trigger).toBe("ambiguous_top_two");
    expect(rec?.margin).toBeCloseTo(0.02, 4);
  });

  it("records a ticket that retrieved nothing at all", () => {
    const ev = assessEvidence(retrieval([]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.review, wouldHaveBeen: DECISION.auto, weak: true, confidence: 0 }), false, undefined, ev);
    expect(rec?.trigger).toBe("no_documents");
    expect([rec?.top_score, rec?.second_score, rec?.margin]).toEqual([0, null, null]);
  });

  it("carries the raw scores so the thresholds can be audited", () => {
    const ev = assessEvidence(retrieval([0.07, 0.05]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.review, wouldHaveBeen: DECISION.auto, weak: true, confidence: 0.07 }), false, undefined, ev);
    expect(rec?.top_score).toBe(0.07);
    expect(rec?.second_score).toBe(0.05);
    expect(rec?.margin).toBeCloseTo(0.02, 4);
  });
});

describe("fallback records fire on template substitution", () => {
  it("records a substitution even when the evidence was strong", () => {
    const ev = assessEvidence(retrieval([0.63, 0.08]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.auto, confidence: 0.63 }), true, "timeline: unhedged duration", ev);
    expect(rec?.trigger).toBe("template_substituted");
    expect(rec?.action_taken).toBe("template_substituted");
    expect(rec?.reason_not_auto_sent).toMatch(/safety gate/);
    expect(rec?.reason_not_auto_sent).toMatch(/unhedged duration/);
  });

  it("ranks substitution above a downgrade when both happened", () => {
    const ev = assessEvidence(retrieval([0.07, 0.05]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.review, wouldHaveBeen: DECISION.auto, weak: true, confidence: 0.07 }), true, "privacy: currency figure", ev);
    expect(rec?.trigger).toBe("template_substituted");
    expect(rec?.reason_not_auto_sent).toMatch(/weak or missing/);
    expect(rec?.reason_not_auto_sent).toMatch(/safety gate/);
  });
});

describe("weak evidence that did not cause a downgrade", () => {
  it("records a ticket a safety row claimed before the weak-evidence row was reached", () => {
    const ev = assessEvidence(retrieval([0.1482, 0.1063]));
    expect(ev.weak).toBe(true);
    expect(ev.trigger).toBe("ambiguous_top_two");
    // The privacy row already set refuse_and_redirect, so decision === decision_without_evidence_fallback.
    const ctx = ctxFor({ decision: DECISION.refuse, wouldHaveBeen: DECISION.refuse, weak: true, confidence: 0.1482 });
    const rec = buildFallbackRecord(ctx, false, undefined, ev);
    expect(rec).toBeDefined();
    expect(rec?.trigger).toBe("ambiguous_top_two");
    expect(rec?.action_taken).toBe("recorded_only");
    expect(rec?.original_decision).toBe(rec?.final_decision);
    expect(rec?.reason_not_auto_sent).toMatch(/higher-priority rule/);
  });

  it("still reports the raw scores for an undowngraded weak match", () => {
    const ev = assessEvidence(retrieval([0.1482, 0.1063]));
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.refuse, wouldHaveBeen: DECISION.refuse, weak: true, confidence: 0.1482 }), false, undefined, ev);
    expect(rec?.top_score).toBe(0.1482);
    expect(rec?.second_score).toBe(0.1063);
  });
});

describe("near-threshold visibility", () => {
  it("records an adequate-but-not-strong match without changing the decision", () => {
    const ev = assessEvidence(retrieval([0.2, 0.05]));
    expect(ev.weak).toBe(false);
    expect(ev.trigger).toBe("near_threshold");
    const rec = buildFallbackRecord(ctxFor({ decision: DECISION.auto, confidence: 0.2 }), false, undefined, ev);
    expect(rec?.trigger).toBe("near_threshold");
    expect(rec?.action_taken).toBe("recorded_only");
    expect(rec?.original_decision).toBe(rec?.final_decision);
    expect(rec?.reason_not_auto_sent).toMatch(/adequate rather than strong/);
  });

  it("writes nothing when the evidence is strong and the draft passed", () => {
    const ev = assessEvidence(retrieval([0.63, 0.08]));
    expect(ev.trigger).toBe("sufficient");
    expect(buildFallbackRecord(ctxFor({ decision: DECISION.auto, confidence: 0.63 }), false, undefined, ev)).toBeUndefined();
  });
});
