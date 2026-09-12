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
  /** Decoding parameters to fold into the prompt hash. Defaults applied by buildPrompt when absent. */
  identity?: PromptIdentity;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /**
   * sha256 over the prompt text AND the decoding parameters that shape the output: model, temperature, seed and the
   * response schema version. Hashing the text alone would let two runs against different models collide, which
   * misstates reproducibility — the hash is an audit claim, so it has to cover everything that could change the answer.
   */
  hash: string;
}

/** Decoding parameters folded into the prompt hash. */
export interface PromptIdentity {
  model: string;
  temperature: number;
  seed: number;
  schema_version: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Returns drafts for exactly the tickets in req.contexts (reconciliation is the caller's job, but providers should try). */
  draft(prompt: BuiltPrompt, req: DraftRequest): Promise<Result<Draft[]>>;
}
