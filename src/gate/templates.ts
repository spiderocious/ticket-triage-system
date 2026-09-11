import { DECISION } from "../core/constants.js";
import type { Draft } from "../core/types.js";
import type { DraftTicketContext } from "../llm/types.js";

function firstSentences(text: string, n: number): string {
  return text.split(/(?<=[.!?])\s+/).slice(0, n).join(" ").trim();
}

/** Deterministic fallback used when the model's draft and its repair both fail the gate. Quality drops; safety does not. */
export function templateDraft(ctx: DraftTicketContext): Draft {
  const top = ctx.retrieved[0];
  const basis = top ? firstSentences(top.doc.content, 2) : "";
  const titles = ctx.retrieved.map((r) => r.doc.title).join("; ") || "none";
  const security = ctx.signals.is_security_sensitive;

  let customer: string;
  if (ctx.outcome.decision === DECISION.refuse) {
    customer =
      "Thank you for reaching out. We are not able to share account-specific information such as balances or transaction history through this channel. " +
      "Please sign in to your account in the app or on our website, where this information is available to you securely. " +
      "If you are unable to sign in, reply here and our team will help you regain access.";
  } else if (ctx.outcome.decision === DECISION.review) {
    customer =
      `Thank you for contacting us. We have routed this request to our ${security ? "identity verification team" : "support specialists"} for review. ` +
      (security
        ? "For your protection we cannot change security settings over chat or email without completing the documented verification steps. "
        : "") +
      "Our team will follow up with you with the next steps. Please do not share verification codes or passwords with anyone.";
  } else {
    customer =
      "Thank you for getting in touch. " +
      (basis ? `${basis} ` : "") +
      "We have not confirmed the status of your individual case here, so we cannot give an exact completion time. " +
      "Please check back in your account, and reply to this message if you would like our team to look into it further.";
  }

  const internal =
    `Deterministic template substitution: the drafted and repaired responses failed the safety gate. ` +
    `Decision ${ctx.outcome.decision} (risk ${ctx.outcome.risk_level}) set by ${ctx.outcome.rule_fired}. ` +
    `Policy references: ${ctx.outcome.policy_references.join(", ")}. Documents: ${titles}. ` +
    `Retrieval confidence ${ctx.signals.retrieval_confidence}.`;

  return { ticket_id: ctx.ticket.ticket_id, customer_response: customer, internal_reasoning_summary: internal };
}
