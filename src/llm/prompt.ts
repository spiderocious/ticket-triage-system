import { createHash } from "node:crypto";
import { DECISION, RULE } from "../core/constants.js";
import type { BuiltPrompt, DraftRequest, DraftTicketContext } from "./types.js";

/** Plain-English gloss for each known policy rule key. Unknown keys fall back to the raw key. */
const RULE_GLOSSES: Record<string, string> = {
  [RULE.accountData]:
    "Never state or imply account-specific data (balances, transactions, holdings, personal details) — you do not have access to the customer's account.",
  [RULE.timeframes]:
    "Never promise a timeframe that is not verified by a retrieved document; hedged ranges quoted from a document are acceptable.",
  [RULE.security]:
    "Security-sensitive topics (passwords, 2FA, account access, suspected fraud) must be routed to a human reviewer, never resolved here.",
  [RULE.privacy]:
    "Privacy-sensitive requests must be redirected to the customer's authenticated session or a verified channel.",
};

const DECISION_GUIDANCE: Record<string, string> = {
  [DECISION.auto]:
    "GUIDANCE (auto_answer): Answer the question directly using only the retrieved snippets. Stay general — describe how the process works, not what happened on this customer's account. Close by inviting the customer to reply if the issue persists.",
  [DECISION.review]:
    "GUIDANCE (needs_human_review): Tell the customer their request has been routed to the right team for review. Do not attempt to resolve it, do not verify identity, and do not change any security setting. State clearly what happens next.",
  [DECISION.refuse]:
    "GUIDANCE (refuse_and_redirect): Politely decline to provide the requested account-specific or private information through this channel, explain that it is available in the customer's authenticated session, and give a clear next step if they cannot sign in.",
};

function buildSystem(req: DraftRequest): string {
  const lines: string[] = [];
  lines.push(
    "You are a customer support drafting assistant. You draft customer support replies ONLY.",
    "The decision and the risk level for every ticket were already computed by deterministic code before you were called.",
    "They are FACTS TO EXPRESS. Never question them, never contradict them, never change them, and never mention that a system made them.",
    "",
    "Policy rules (hard constraints):",
  );
  for (const [key, value] of Object.entries(req.policy.rules)) {
    if (value !== true) continue;
    lines.push(`- ${key}: ${RULE_GLOSSES[key] ?? key}`);
  }
  lines.push(
    "",
    "Safe-response rules (hard constraints):",
    "- Never state or imply account-specific balances, transactions, or personal data.",
    "- Never promise an exact resolution time. Hedged ranges taken from a retrieved document are acceptable.",
    "- Never offer to disable, bypass or skip a security or verification procedure.",
    "- Ground every answer in the retrieved snippets. Do not invent facts, figures, policies or timelines.",
    "- Every refusal or escalation must state a clear, polite next step.",
    "",
    "Output format:",
    "- Return a JSON object with a `drafts` array of objects `{ticket_id, customer_response, internal_reasoning_summary}`.",
    "- Return exactly one entry per ticket requested, with the ticket_id copied verbatim.",
    "- `customer_response` must be at least 40 characters.",
    "- `internal_reasoning_summary` must be at least 20 characters.",
    "- `internal_reasoning_summary` is written for support staff, not for the customer.",
  );
  return lines.join("\n");
}

function buildTicketBlock(ctx: DraftTicketContext): string[] {
  const { ticket, signals, outcome, retrieved } = ctx;
  const lines: string[] = [];
  lines.push(`--- TICKET ${ticket.ticket_id} ---`);
  lines.push(`Channel: ${ticket.channel} | Tier: ${ticket.customer_tier} | Language: ${ticket.language}`);
  lines.push(`Subject: ${ticket.subject}`);
  lines.push(`Message: ${ticket.message}`);
  lines.push(`DECISION (already made, express it): ${outcome.decision}`);
  lines.push(`RISK LEVEL: ${outcome.risk_level}`);
  lines.push(`POLICY REFERENCES: ${outcome.policy_references.join(", ")}`);
  lines.push("SIGNALS:");
  lines.push(`- asks_for_account_specific_data: ${String(signals.asks_for_account_specific_data)}`);
  lines.push(`- is_security_sensitive: ${String(signals.is_security_sensitive)}`);
  lines.push(`- asks_for_guaranteed_timeline: ${String(signals.asks_for_guaranteed_timeline)}`);
  lines.push(`- evidence_is_weak_or_missing: ${String(signals.evidence_is_weak_or_missing)}`);
  lines.push(`- safe_for_auto_answer: ${String(signals.safe_for_auto_answer)}`);
  lines.push(`MATCHED PHRASES: ${signals.matched_phrases.join(", ")}`);
  lines.push("RETRIEVED SNIPPETS:");
  for (const item of retrieved) {
    lines.push(`[${item.doc.doc_id}] ${item.doc.title} (${item.doc.category}, ${String(item.score)}): ${item.doc.content}`);
  }
  const guidance = DECISION_GUIDANCE[outcome.decision];
  if (guidance !== undefined) lines.push(guidance);
  return lines;
}

function buildUser(req: DraftRequest): string {
  const lines: string[] = [];
  for (const ctx of req.contexts) {
    lines.push(...buildTicketBlock(ctx));
    lines.push("");
  }
  const notes = req.repairNotes;
  if (notes !== undefined && Object.keys(notes).length > 0) {
    lines.push("--- REPAIR REQUIRED ---");
    lines.push("A safety gate rejected the previous drafts for these tickets:");
    for (const [ticketId, violations] of Object.entries(notes)) {
      lines.push(`${ticketId}: ${violations.join(", ")}`);
    }
    lines.push("Return drafts ONLY for the listed ticket ids, fixing exactly those violations.");
    lines.push("Keep the decision and risk level unchanged; only the wording is at fault.");
  }
  return lines.join("\n");
}

/** Deterministic prompt builder. Same request => same strings => same hash. */
export function buildPrompt(req: DraftRequest): BuiltPrompt {
  const system = buildSystem(req);
  const user = buildUser(req);
  const hash = createHash("sha256").update(`${system}\n---\n${user}`).digest("hex");
  return { system, user, hash };
}
