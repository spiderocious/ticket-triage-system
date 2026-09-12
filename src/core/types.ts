import type { z } from "zod";
import type { TicketSchema, KbDocSchema, PolicySchema } from "../io/schemas.js";

export type Ticket = z.infer<typeof TicketSchema>;
export type KbDoc = z.infer<typeof KbDocSchema>;
export type Policy = z.infer<typeof PolicySchema>;

export interface Inputs {
  tickets: Ticket[];
  kb: KbDoc[];
  policy: Policy;
}

export interface RetrievedDoc {
  doc_id: string;
  score: number;
  match_reasons: string[];
}
export interface RetrievalRecord {
  ticket_id: string;
  retrieved: RetrievedDoc[];
}

export interface RoutingSignals {
  ticket_id: string;
  asks_for_account_specific_data: boolean;
  is_security_sensitive: boolean;
  asks_for_guaranteed_timeline: boolean;
  evidence_is_weak_or_missing: boolean;
  safe_for_auto_answer: boolean;
  matched_phrases: string[];
  triggered_rules: string[];
  relevant_doc_ids: string[];
  /** Deterministic 0..1 confidence derived from retrieval scores (feeds fallback_analysis). */
  retrieval_confidence: number;
}

export interface DecisionOutcome {
  decision: string;
  risk_level: string;
  policy_references: string[];
  /** Ladder row that fired, for explainability. */
  rule_fired: string;
  /** Decision the ladder would have produced if evidence had not been weak (for fallback_analysis). */
  decision_without_evidence_fallback: string;
}

export interface Draft {
  ticket_id: string;
  customer_response: string;
  internal_reasoning_summary: string;
}

export interface TriageRecord {
  ticket_id: string;
  decision: string;
  risk_level: string;
  retrieved_doc_ids: string[];
  policy_references: string[];
  customer_response: string;
  internal_reasoning_summary: string;
  [extra: string]: unknown;
}

export interface LlmCallRecord {
  stage: "response_generation" | "response_repair";
  ticket_id: string | null;
  timestamp: string;
  provider: string;
  model: string;
  prompt_hash: string;
  input_artifacts: string[];
  output_artifact: string;
  /** Extra audit fields beyond the required set. */
  ticket_ids?: string[];
  outcome?: "ok" | "invalid_output" | "call_failed";
}

export interface FallbackRecord {
  ticket_id: string;
  retrieval_confidence: number;
  original_decision: string;
  final_decision: string;
  reason_not_auto_sent: string;
  /** Top retrieval score, or 0 when nothing was retrieved. */
  top_score: number;
  /** Runner-up score, or null when fewer than two documents were retrieved. */
  second_score: number | null;
  /** top_score - second_score, or null when there is no runner-up. A narrow margin means an ambiguous match. */
  margin: number | null;
  /** Which trigger fired: below_floor | ambiguous_top_two | no_documents | near_threshold | template_substituted. */
  trigger: string;
  /** What the pipeline did about it. */
  action_taken: string;
}
