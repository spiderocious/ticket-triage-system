import type { DecisionOutcome, Draft, KbDoc, Policy, RoutingSignals, Ticket } from "../core/types.js";
import type { Result } from "../core/result.js";

export interface DraftTicketContext {
  ticket: Ticket;
  retrieved: Array<{ doc: KbDoc; score: number }>;
  signals: RoutingSignals;
  outcome: DecisionOutcome;
}

export interface DraftRequest {
  contexts: DraftTicketContext[];
  policy: Policy;
  /** Present only on a repair call: ticket_id -> violations from the safety gate. */
  repairNotes?: Record<string, string[]>;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /** sha256 of system + "\n---\n" + user. */
  hash: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Returns drafts for exactly the tickets in req.contexts (reconciliation is the caller's job, but providers should try). */
  draft(prompt: BuiltPrompt, req: DraftRequest): Promise<Result<Draft[]>>;
}
