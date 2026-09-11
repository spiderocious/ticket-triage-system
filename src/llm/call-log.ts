import type { LlmCallRecord } from "../core/types.js";

export interface CallRecordArgs {
  stage: LlmCallRecord["stage"];
  ticketId: string | null;
  provider: string;
  model: string;
  promptHash: string;
  inputArtifacts: string[];
  outputArtifact: string;
  ticketIds: string[];
  outcome: NonNullable<LlmCallRecord["outcome"]>;
  /** Injectable clock so audit records are testable. */
  now?: Date;
}

/** Builds one auditable llm_calls.jsonl row. */
export function makeCallRecord(args: CallRecordArgs): LlmCallRecord {
  return {
    stage: args.stage,
    ticket_id: args.ticketId,
    timestamp: (args.now ?? new Date()).toISOString(),
    provider: args.provider,
    model: args.model,
    prompt_hash: args.promptHash,
    input_artifacts: args.inputArtifacts,
    output_artifact: args.outputArtifact,
    ticket_ids: args.ticketIds,
    outcome: args.outcome,
  };
}
