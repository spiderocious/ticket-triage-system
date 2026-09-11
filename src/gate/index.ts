// CONTRACT — implemented by gate module. Pure. Shared with validator.
import type { Draft, Policy } from "../core/types.js";
import type { DraftTicketContext } from "../llm/types.js";

/** Content validators. Returns violation strings (empty = pass). Keyed off the same signals that produced the decision:
 *  - account/privacy-flagged: no currency figures, no balance/transaction disclosure phrasing.
 *  - timeline-flagged (or any auto_answer): no exact completion promise (within/in/by N hours|days|minutes, "will complete by", "guaranteed").
 *  - all: no offer to disable / bypass / skip / turn off 2FA or verification.
 *  - refuse_and_redirect / needs_human_review: must state a next step.
 *  - all: customer_response >= 40 chars, internal_reasoning_summary >= 20 chars.
 */
export function checkDraft(_draft: Draft, _ctx: DraftTicketContext, _policy: Policy): string[] {
  throw new Error("not implemented");
}

/** Standalone versions the validator can call with only text + flags (no full context). */
export function checkPrivacyText(_text: string): string[] {
  throw new Error("not implemented");
}
export function checkTimelineText(_text: string): string[] {
  throw new Error("not implemented");
}
export function checkSecurityBypassText(_text: string): string[] {
  throw new Error("not implemented");
}

/** Deterministic fallback draft built from decision + retrieved doc titles. Must itself pass checkDraft. */
export function templateDraft(_ctx: DraftTicketContext): Draft {
  throw new Error("not implemented");
}
