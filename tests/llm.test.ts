import { describe, expect, it } from "vitest";
import { DECISION, RISK, RULE } from "../src/core/constants.js";
import { ERR } from "../src/core/errors.js";
import type { DecisionOutcome, KbDoc, Policy, RoutingSignals, Ticket } from "../src/core/types.js";
import { buildPrompt, checkNoRoutingFields, createProvider, validateDrafts } from "../src/llm/index.js";
import { MockProvider } from "../src/llm/mock.js";
import type { DraftRequest, DraftTicketContext } from "../src/llm/types.js";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: "T-1",
    created_at: "2025-01-01T00:00:00Z",
    channel: "email",
    language: "en",
    customer_tier: "standard",
    subject: "Where is my withdrawal?",
    message: "I requested a withdrawal and it has not arrived yet.",
    ...overrides,
  };
}

function doc(overrides: Partial<KbDoc> = {}): KbDoc {
  return {
    doc_id: "KB-1",
    title: "Withdrawal processing",
    category: "payments",
    content: "Withdrawals are reviewed before they are released. Processing typically takes up to 3 days. Banks may add their own delay.",
    tags: ["withdrawal"],
    ...overrides,
  };
}

function signals(overrides: Partial<RoutingSignals> = {}): RoutingSignals {
  return {
    ticket_id: "T-1",
    asks_for_account_specific_data: false,
    is_security_sensitive: false,
    asks_for_guaranteed_timeline: false,
    evidence_is_weak_or_missing: false,
    safe_for_auto_answer: true,
    matched_phrases: ["withdrawal"],
    triggered_rules: [],
    relevant_doc_ids: ["KB-1"],
    retrieval_confidence: 0.82,
    ...overrides,
  };
}

function outcome(overrides: Partial<DecisionOutcome> = {}): DecisionOutcome {
  return {
    decision: DECISION.auto,
    risk_level: RISK.low,
    policy_references: [RULE.timeframes],
    rule_fired: "ladder_row_default",
    decision_without_evidence_fallback: DECISION.auto,
    ...overrides,
  };
}

const policy: Policy = {
  allowed_decisions: [DECISION.auto, DECISION.review, DECISION.refuse],
  allowed_risk_levels: [RISK.low, RISK.medium, RISK.high, RISK.critical],
  required_output_fields: ["ticket_id", "customer_response", "internal_reasoning_summary"],
  rules: {
    [RULE.accountData]: true,
    [RULE.timeframes]: true,
    [RULE.security]: true,
    [RULE.privacy]: false,
  },
};

function context(overrides: Partial<DraftTicketContext> = {}): DraftTicketContext {
  return {
    ticket: ticket(),
    retrieved: [{ doc: doc(), score: 0.71 }],
    signals: signals(),
    outcome: outcome(),
    ...overrides,
  };
}

function request(contexts: DraftTicketContext[], repairNotes?: Record<string, string[]>): DraftRequest {
  return repairNotes === undefined ? { contexts, policy } : { contexts, policy, repairNotes };
}

describe("buildPrompt", () => {
  it("is deterministic across two identical builds", () => {
    const req = request([context()]);
    expect(buildPrompt(req).hash).toBe(buildPrompt(req).hash);
  });

  it("changes hash when a ticket message changes", () => {
    const a = buildPrompt(request([context()]));
    const b = buildPrompt(request([context({ ticket: ticket({ message: "Completely different text." }) })]));
    expect(a.hash).not.toBe(b.hash);
  });

  it("includes every ticket id and decision string in the user text", () => {
    const contexts = [
      context(),
      context({
        ticket: ticket({ ticket_id: "T-2", subject: "Reset my 2FA" }),
        signals: signals({ ticket_id: "T-2", is_security_sensitive: true }),
        outcome: outcome({ decision: DECISION.review, risk_level: RISK.high }),
      }),
    ];
    const { user } = buildPrompt(request(contexts));
    expect(user).toContain("T-1");
    expect(user).toContain("T-2");
    expect(user).toContain(DECISION.auto);
    expect(user).toContain(DECISION.review);
  });

  it("lists each true policy rule key in the system text and omits false ones", () => {
    const { system } = buildPrompt(request([context()]));
    expect(system).toContain(RULE.accountData);
    expect(system).toContain(RULE.timeframes);
    expect(system).toContain(RULE.security);
    expect(system).not.toContain(RULE.privacy);
  });

  it("appends a repair section naming the ticket and its violations", () => {
    const { user } = buildPrompt(request([context()], { "T-1": ["promised_timeframe"] }));
    expect(user).toContain("--- REPAIR REQUIRED ---");
    expect(user).toContain("T-1: promised_timeframe");
  });
});

describe("validateDrafts", () => {
  const good = { ticket_id: "T-1", customer_response: "x".repeat(50), internal_reasoning_summary: "y".repeat(30) };

  it("accepts a bare array by wrapping it", () => {
    const res = validateDrafts([good], ["T-1"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toHaveLength(1);
  });

  it("rejects a draft with a missing field", () => {
    const res = validateDrafts({ drafts: [{ ticket_id: "T-1", customer_response: "hello" }] }, ["T-1"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.identity).toBe(ERR.llm_output_invalid);
  });

  it("rejects missing ticket ids", () => {
    const res = validateDrafts({ drafts: [good] }, ["T-1", "T-2"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.identity).toBe(ERR.ticket_reconciliation_failed);
      expect(res.error.detail).toContain("missing: T-2");
    }
  });

  it("rejects duplicate ticket ids", () => {
    const res = validateDrafts({ drafts: [good, good] }, ["T-1"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.identity).toBe(ERR.ticket_reconciliation_failed);
      expect(res.error.detail).toContain("duplicate: T-1");
    }
  });

  it("rejects unknown ticket ids", () => {
    const res = validateDrafts({ drafts: [good, { ...good, ticket_id: "T-9" }] }, ["T-1"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.identity).toBe(ERR.ticket_reconciliation_failed);
      expect(res.error.detail).toContain("unknown: T-9");
    }
  });

  it("returns drafts ordered by expectedTicketIds", () => {
    const second = { ...good, ticket_id: "T-2" };
    const res = validateDrafts({ drafts: [second, good] }, ["T-1", "T-2"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.map((d) => d.ticket_id)).toEqual(["T-1", "T-2"]);
  });
});

describe("MockProvider", () => {
  const contexts = [
    context(),
    context({
      ticket: ticket({ ticket_id: "T-2", subject: "Reset my 2FA" }),
      signals: signals({ ticket_id: "T-2", is_security_sensitive: true }),
      outcome: outcome({ decision: DECISION.review, risk_level: RISK.high }),
    }),
    context({
      ticket: ticket({ ticket_id: "T-3", subject: "What is my balance?" }),
      signals: signals({ ticket_id: "T-3", asks_for_account_specific_data: true }),
      outcome: outcome({ decision: DECISION.refuse, risk_level: RISK.medium }),
    }),
  ];

  it("returns one draft per context, above the length minimums", async () => {
    const req = request(contexts);
    const res = await new MockProvider().draft(buildPrompt(req), req);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(3);
    expect(res.value.map((d) => d.ticket_id)).toEqual(["T-1", "T-2", "T-3"]);
    for (const d of res.value) {
      expect(d.customer_response.length).toBeGreaterThanOrEqual(40);
      expect(d.internal_reasoning_summary.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("emits no currency amounts or durations for refuse or review decisions", async () => {
    const req = request(contexts);
    const res = await new MockProvider().draft(buildPrompt(req), req);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const risky = res.value.filter((d) => d.ticket_id === "T-2" || d.ticket_id === "T-3");
    expect(risky).toHaveLength(2);
    for (const d of risky) {
      expect(d.customer_response).not.toMatch(/[$€£₦]\s?\d/);
      expect(d.customer_response).not.toMatch(/\b\d+\s*(hours?|days?|minutes?)\b/);
    }
  });

  it("drafts only the repair-listed tickets", async () => {
    const req = request(contexts, { "T-2": ["unsafe_promise"] });
    const res = await new MockProvider().draft(buildPrompt(req), req);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.map((d) => d.ticket_id)).toEqual(["T-2"]);
  });

  it("is deterministic", async () => {
    const req = request(contexts);
    const a = await new MockProvider().draft(buildPrompt(req), req);
    const b = await new MockProvider().draft(buildPrompt(req), req);
    expect(a).toEqual(b);
  });
});

describe("createProvider", () => {
  it("errors with llm_key_missing when the openai key is absent", () => {
    const res = createProvider("openai", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.identity).toBe(ERR.llm_key_missing);
  });

  it("errors with llm_provider_unknown for an unrecognised name", () => {
    const res = createProvider("nope", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.identity).toBe(ERR.llm_provider_unknown);
  });

  it("builds the mock provider", () => {
    const res = createProvider("mock", {});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.name).toBe("mock");
  });
});

describe("the model may not own the routing decision", () => {
  const policy: Policy = {
    allowed_decisions: ["auto_answer", "needs_human_review", "refuse_and_redirect"],
    allowed_risk_levels: ["low", "medium", "high", "critical"],
    required_output_fields: ["ticket_id", "decision"],
    rules: { must_not_claim_account_specific_data: true },
  };
  const ticket: Ticket = { ticket_id: "t1", created_at: "2025-08-04T09:00:00Z", channel: "chat", language: "en", customer_tier: "standard", subject: "s", message: "m" };
  const signals: RoutingSignals = {
    ticket_id: "t1", asks_for_account_specific_data: false, is_security_sensitive: false, asks_for_guaranteed_timeline: false,
    evidence_is_weak_or_missing: false, safe_for_auto_answer: true, matched_phrases: [], triggered_rules: [], relevant_doc_ids: ["kb_001"], retrieval_confidence: 0.5,
  };
  const outcome: DecisionOutcome = { decision: "auto_answer", risk_level: "low", policy_references: ["must_not_claim_account_specific_data"], rule_fired: "ladder_5_default", decision_without_evidence_fallback: "auto_answer" };
  const contexts: DraftTicketContext[] = [{ ticket, retrieved: [], signals, outcome }];
  const body = { ticket_id: "t1", customer_response: "x".repeat(60), internal_reasoning_summary: "y".repeat(30) };

  it("accepts a draft carrying no routing fields", () => {
    expect(checkNoRoutingFields({ drafts: [body] }, contexts, policy).ok).toBe(true);
  });
  it("rejects a draft that contradicts the computed decision", () => {
    const r = checkNoRoutingFields({ drafts: [{ ...body, decision: "refuse_and_redirect" }] }, contexts, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.identity).toBe("llm_owned_decision");
      expect(r.error.detail ?? "").toContain("contradicts");
    }
  });
  it("rejects a draft using a decision the policy does not allow", () => {
    const r = checkNoRoutingFields({ drafts: [{ ...body, decision: "DELETE_EVERYTHING" }] }, contexts, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail ?? "").toContain("not an allowed decision");
  });
  it("rejects a draft using a risk level the policy does not allow", () => {
    const r = checkNoRoutingFields({ drafts: [{ ...body, risk_level: "nuclear" }] }, contexts, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail ?? "").toContain("not an allowed risk level");
  });
  it("rejects even a routing field that agrees, because the model gets no vote", () => {
    const r = checkNoRoutingFields({ drafts: [{ ...body, decision: "auto_answer" }] }, contexts, policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail ?? "").toContain("agrees with");
  });
  it("strips harmless unknown keys without failing", () => {
    const r = validateDrafts({ drafts: [{ ...body, tone: "friendly" }] }, ["t1"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value[0] ?? {})).not.toContain("tone");
  });
});
