/** Stable snake_case error identities. Clients and tests branch on these, never on messages. */
export const ERR = {
  input_missing: "input_missing",
  input_malformed: "input_malformed",
  schema_violation: "schema_violation",
  duplicate_id: "duplicate_id",
  policy_invalid: "policy_invalid",
  decision_not_allowed: "decision_not_allowed",
  risk_not_allowed: "risk_not_allowed",
  signal_untraceable: "signal_untraceable",
  llm_key_missing: "llm_key_missing",
  llm_provider_unknown: "llm_provider_unknown",
  llm_call_failed: "llm_call_failed",
  llm_output_invalid: "llm_output_invalid",
  ticket_reconciliation_failed: "ticket_reconciliation_failed",
  safety_violation: "safety_violation",
  required_field_unsupported: "required_field_unsupported",
  artifact_missing: "artifact_missing",
  artifact_invalid: "artifact_invalid",
  decision_mismatch: "decision_mismatch",
  write_failed: "write_failed",
} as const;

export type ErrorIdentity = (typeof ERR)[keyof typeof ERR];
