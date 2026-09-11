import { DECISION } from "../core/constants.js";
import type { Draft, Policy } from "../core/types.js";
import type { DraftTicketContext } from "../llm/types.js";

const CURRENCY = /[$€£₦]\s?\d[\d,]*(\.\d+)?/gi;
const CURRENCY_WORDS = /\b\d[\d,]*(\.\d+)?\s?(usd|eur|gbp|ngn|dollars?|euros?|pounds?|naira)\b/gi;
const BALANCE_PHRASES = [
  /\byour (current |account |available )?balance is\b[^.]*/gi,
  /\bbalance of \d[\d,]*(\.\d+)?/gi,
  /\byou (currently )?have \d[\d,]*(\.\d+)?/gi,
  /\byour (last|recent) (\d+ )?transactions? (are|were|is|include|:)/gi,
  /\btransaction (on|dated) \d/gi,
];
const ACCOUNT_NUMBER = /\b\d{8,}\b/g;

function collect(text: string, patterns: RegExp[], label: string): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`))) {
      if (m[0]) out.push(`${label}: ${m[0].trim()}`);
    }
  }
  return [...new Set(out)];
}

export function checkPrivacyText(text: string): string[] {
  return [
    ...collect(text, [CURRENCY, CURRENCY_WORDS], "privacy: currency figure"),
    ...collect(text, BALANCE_PHRASES, "privacy: account-specific disclosure"),
    ...collect(text, [ACCOUNT_NUMBER], "privacy: possible account or card number"),
  ];
}

const HEDGES = /\b(typical(ly)?|usual(ly)?|general(ly)?|may|might|can|could|up to|often|sometimes|exception|estimate|approximate|around|about|no guarantee|cannot guarantee|not guaranteed|unable to guarantee)\b/i;
const DURATION = /\b(within|in|by|inside|after|under)\s+(the next\s+)?\d+\s*(hours?|hrs?|days?|minutes?|mins?|business days?|weeks?)\b/i;
const COMPLETION_VERB = /\b(complete|completed|process|processed|arrive|resolved?|credited|done|receive|finish(ed)?|clear(ed)?|refunded|paid)\b/i;
const HARD_PROMISE = [
  /\bwill (be )?(completed?|processed?|arrive|be done|be credited|be resolved|clear) (by|within|in|before)\b[^.]*/gi,
  /\bguarantee[ds]?\b[^.]*/gi,
  /\bno later than\b[^.]*/gi,
  /\bby (tomorrow|tonight|end of (the )?day|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
];

/** Numeric durations are only allowed inside a hedged sentence (as the knowledge base itself phrases them). */
export function checkTimelineText(text: string): string[] {
  const violations = collect(text, HARD_PROMISE, "timeline: unsupported promise");
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const d = DURATION.exec(sentence);
    if (!d) continue;
    const hedged = HEDGES.test(sentence);
    const promissory = COMPLETION_VERB.test(sentence) || /\bwill\b/i.test(sentence);
    if (promissory && !hedged) violations.push(`timeline: unhedged duration "${d[0]}"`);
  }
  return [...new Set(violations)];
}

const BYPASS = [
  /\b(i|we)\s?('ve|'ll| have| will| can| am able to)?\s?(disabled?|turned? off|removed?|reset|bypass(ed)?|skipp?(ed)?)\s+(your\s+)?(2 ?fa|two[- ]factor|mfa|verification|authentication|security check)/gi,
  /\b(disable|turn off|bypass|skip|remove)\s+(the\s+|your\s+)?(2 ?fa|two[- ]factor|mfa|verification|authentication)\s+(for you|now|immediately|right away)/gi,
  /\bwithout (verification|verifying|completing verification)\b/gi,
  /\bno need to verify\b/gi,
  /\bi ?('ve| have) reset your (password|2 ?fa|security settings)/gi,
];

export function checkSecurityBypassText(text: string): string[] {
  return collect(text, BYPASS, "security: offers to bypass a control");
}

const NEXT_STEP = [
  /\blog ?in\b/i, /\bsign ?in\b/i, /\bin the app\b/i, /\baccount (area|dashboard|settings|page)\b/i,
  /\bour (team|specialists?|agents?)\b[^.]*\bwill\b/i, /\bwill (contact|reach out|follow up|be in touch|get back)\b/i,
  /\byou will (hear|receive|get)\b/i, /\bplease (visit|use|go to|contact|reply|check|sign|log)\b/i,
  /\bnext steps?\b/i, /\b(has been|have) (escalated|forwarded|routed)\b/i, /\bverification (team|process|flow|steps)\b/i,
  /\bsecurely\b/i, /\breply (here|to this)\b/i,
];

export function checkNextStep(text: string): string[] {
  return NEXT_STEP.some((p) => p.test(text)) ? [] : ["next_step: refusal or escalation does not state a clear next step"];
}

const GATE_STOPWORDS = new Set(["the","and","for","are","was","with","that","this","your","you","our","can","not","but","may","have","has","from","will","their","its","any","all","unless","must","through","into","other","such"]);
function gateTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !GATE_STOPWORDS.has(w)).map((w) => (w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export function checkGrounding(draft: Draft, ctx: DraftTicketContext): string[] {
  const top = ctx.retrieved[0];
  if (!top) return [];
  const docSet = new Set(gateTokens(`${top.doc.title} ${top.doc.content} ${top.doc.tags.join(" ")}`));
  const shared = new Set(gateTokens(draft.customer_response).filter((t) => docSet.has(t)));
  return shared.size >= 2 ? [] : ["grounding: response does not draw on the retrieved documents"];
}

/** The full gate for one draft. Structural validity is not safety, so every check runs against the final text. */
export function checkDraft(draft: Draft, ctx: DraftTicketContext, policy: Policy): string[] {
  const v: string[] = [];
  if (draft.customer_response.trim().length < 40) v.push("length: customer_response shorter than 40 characters");
  if (draft.internal_reasoning_summary.trim().length < 20) v.push("length: internal_reasoning_summary shorter than 20 characters");

  // A balance figure is never acceptable in a customer reply, whatever the ticket asked.
  v.push(...checkPrivacyText(draft.customer_response));
  v.push(...checkSecurityBypassText(draft.customer_response), ...checkSecurityBypassText(draft.internal_reasoning_summary));

  if (ctx.signals.asks_for_guaranteed_timeline || ctx.outcome.decision === DECISION.auto) {
    v.push(...checkTimelineText(draft.customer_response));
  }
  if (ctx.outcome.decision === DECISION.refuse || ctx.outcome.decision === DECISION.review) {
    v.push(...checkNextStep(draft.customer_response));
  }
  if (ctx.outcome.decision === DECISION.auto && ctx.retrieved.length > 0) {
    v.push(...checkGrounding(draft, ctx));
  }
  void policy; // policy rules are enforced upstream via signals; kept in the signature for future rule-driven checks
  return [...new Set(v)];
}
