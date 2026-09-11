// CONTRACT — implemented by llm module.
import type { Draft } from "../core/types.js";
import type { Result } from "../core/result.js";
import type { BuiltPrompt, DraftRequest, LlmProvider } from "./types.js";
export type { BuiltPrompt, DraftRequest, DraftTicketContext, LlmProvider } from "./types.js";

/** Deterministic prompt builder. Same request => same strings => same hash. Includes policy rules as hard constraints,
 *  the decision + risk as facts to express, retrieved snippets, signals, and repair notes if present. */
export function buildPrompt(_req: DraftRequest): BuiltPrompt {
  throw new Error("not implemented");
}

/** "openai" -> OpenAI provider (err llm_key_missing if no key), "mock" -> deterministic templates, else err llm_provider_unknown. */
export function createProvider(_name: string, _env: NodeJS.ProcessEnv): Result<LlmProvider> {
  throw new Error("not implemented");
}

/** Validate unknown provider output against the Draft schema and reconcile ticket ids 1:1 with expected.
 *  err(llm_output_invalid) on schema failure, err(ticket_reconciliation_failed) on missing/duplicate/unknown ids.
 *  Returned drafts are in the order of `expectedTicketIds`. */
export function validateDrafts(_raw: unknown, _expectedTicketIds: string[]): Result<Draft[]>;
export function validateDrafts(): Result<Draft[]> {
  throw new Error("not implemented");
}
