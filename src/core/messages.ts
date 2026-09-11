import type { ErrorIdentity } from "./errors.js";
import type { AppError } from "./result.js";

/** Message registry — the only place user-facing error text lives. */
export const MESSAGES: Record<ErrorIdentity, string> = {
  input_missing: "An input file could not be found.",
  input_malformed: "An input file is not valid JSON.",
  schema_violation: "An input file does not match the required schema.",
  duplicate_id: "An input file contains a duplicate identifier.",
  policy_invalid: "The response policy is missing required enumerations.",
  decision_not_allowed: "The computed decision is not in the policy's allowed_decisions.",
  risk_not_allowed: "The computed risk level is not in the policy's allowed_risk_levels.",
  signal_untraceable: "A routing signal was set without supporting evidence.",
  llm_key_missing: "OPENAI_API_KEY is not set. Set it, or run with LLM_PROVIDER=mock.",
  llm_provider_unknown: "Unknown LLM provider. Use 'openai' or 'mock'.",
  llm_call_failed: "The LLM call failed.",
  llm_output_invalid: "The LLM returned output that failed schema validation.",
  llm_owned_decision: "The LLM returned a routing decision or risk level, which only deterministic code may set.",
  ticket_reconciliation_failed: "LLM drafts do not reconcile one-to-one with input tickets.",
  safety_violation: "A drafted response violated a safety constraint.",
  required_field_unsupported: "The policy requires an output field this pipeline cannot supply.",
  artifact_missing: "A required artifact is missing.",
  artifact_invalid: "An artifact is present but invalid.",
  decision_mismatch: "A final decision does not match the deterministic re-derivation.",
  write_failed: "Writing an artifact failed.",
};

export function appError(identity: ErrorIdentity, detail?: string): AppError {
  return detail === undefined ? { identity, message: MESSAGES[identity] } : { identity, message: MESSAGES[identity], detail };
}
