/** Every tunable constant, named and exported so design_notes.md and the validator cite the same values. */
export const SCORE_PRECISION = 4;
export const TOP_K_DEFAULT = 3;
/** Cosine similarity below this on the top document means evidence is weak. */
export const WEAK_EVIDENCE_FLOOR = 0.1;
/** If top-1 minus top-2 is below this AND top-1 is below STRONG_EVIDENCE_BAR, evidence is ambiguous (weak). */
export const WEAK_EVIDENCE_MARGIN = 0.05;
export const STRONG_EVIDENCE_BAR = 0.35;

export const DEFAULT_OPENAI_MODEL = "gpt-4o-2024-08-06";
export const OPENAI_SEED = 7;
export const MOCK_PROVIDER_NAME = "mock";
export const MOCK_MODEL_NAME = "deterministic-template-v1";

export const ARTIFACTS = {
  retrieval: "retrieval_results.json",
  signals: "routing_signals.json",
  triage: "triage_results.json",
  llmCalls: "llm_calls.jsonl",
  fallback: "fallback_analysis.json",
} as const;

export const INPUT_DEFAULTS = {
  tickets: "tickets.json",
  kb: "knowledge_base.json",
  policy: "response_policy.json",
} as const;

/** Policy rule keys the pipeline knows how to enforce. Read from policy at runtime; these are only lookups. */
export const RULE = {
  accountData: "must_not_claim_account_specific_data",
  timeframes: "must_not_promise_unverified_timeframes",
  security: "security_sensitive_topics_require_review",
  privacy: "privacy_sensitive_requests_must_be_redirected",
} as const;

/** Decision and risk vocabulary the ladder emits. Each is verified against the policy enums at runtime. */
export const DECISION = { auto: "auto_answer", review: "needs_human_review", refuse: "refuse_and_redirect" } as const;
export const RISK = { low: "low", medium: "medium", high: "high", critical: "critical" } as const;
