/** Phrase detectors. Each returns the literal spans as they appear in the original text. */
export interface Detection {
  matched: boolean;
  spans: string[];
}

function run(text: string, patterns: RegExp[]): Detection {
  const spans: string[] = [];
  for (const p of patterns) {
    const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    for (const m of text.matchAll(re)) if (m[0]) spans.push(m[0]);
  }
  const unique = [...new Set(spans)].sort((a, b) => text.indexOf(a) - text.indexOf(b));
  return { matched: unique.length > 0, spans: unique };
}

export const ACCOUNT_DATA_PATTERNS: RegExp[] = [
  /\b(my |current |account |available )*balance\b/i,
  /\btransactions?( history| list| details)?\b/i,
  /\b(bank |account )?statements?\b/i,
  /\blast \d+ (transactions|payments|deposits|withdrawals|transfers)\b/i,
  /\bhow much (do i have|is (left )?in|came in(to)?|went (out|into)|has (come|gone)|did i (spend|receive|send|get|deposit|withdraw)|money (is|do i))\b/i,
  /\bhow much .{0,20}\b(in|into|from|on) my account\b/i,
  /\b(confirm|check|know|see|tell me) how much\b/i,
  /\bfunds (in|on) my account\b/i,
  /\b(recent|latest) activity\b/i,
  /\bwhat (did|have) i (spent|spend|received|receive|sent|send)\b/i,
  /\bshow me my (account|payments|deposits|withdrawals|transfers|history)\b/i,
  /\b(list|see|view|show|send|give) (me )?(my |all )?(recent |past |previous )?(payments|deposits|withdrawals|transfers|history)\b/i,
  /\baccount (number|details|summary|overview)\b/i,
  /\bcard number\b/i,
];

export const SECURITY_PATTERNS: RegExp[] = [
  /\b2 ?fa\b/i,
  /\btwo[- ]factor\b/i,
  /\bauthenticator\b/i,
  /\botp\b/i,
  /\bmfa\b/i,
  /\bsecurity code\b/i,
  /\b(reset|change|recover|forgot|forgotten)( my)? password\b/i,
  /\bpassword reset\b/i,
  /\blocked out\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bhacked\b/i,
  /\bcompromised\b/i,
  /\bsomeone (else )?(accessed|logged|used|got into)\b/i,
  /\b(disable|turn off|remove|bypass|skip) (my |the )?(2fa|two[- ]factor|mfa|verification|authentication)\b/i,
  /\bverification code\b/i,
  /\bidentity verification\b/i,
  /\blost (my )?(phone|device)\b/i,
  /\bno longer have access to my (phone|device|email|number)\b/i,
];

export const TIMELINE_PATTERNS: RegExp[] = [
  /\bwhen will\b/i,
  /\bhow long\b/i,
  /\bby when\b/i,
  /\bwhat time\b/i,
  /\bexact(ly)? (when|time|date)\b/i,
  /\bguarantee[ds]?\b/i,
  /\bwithin \d+ (hours?|days?|minutes?)\b/i,
  /\beta\b/i,
  /\bwill it (complete|arrive|be done|be processed|clear|go through)\b/i,
  /\bwhen (it|this|that) will (complete|arrive|be done|clear)\b/i,
  /\bhow many (hours|days|minutes)\b/i,
  /\bstill pending\b/i,
  /\bpending for \d+ (hours?|days?|minutes?)\b/i,
];

export const URGENCY_PATTERNS: RegExp[] = [/\burgent(ly)?\b/i, /\basap\b/i, /\bimmediately\b/i, /\bright now\b/i, /\bemergency\b/i];

export const detectAccountData = (text: string): Detection => run(text, ACCOUNT_DATA_PATTERNS);
export const detectSecurity = (text: string): Detection => run(text, SECURITY_PATTERNS);
export const detectTimeline = (text: string): Detection => run(text, TIMELINE_PATTERNS);
export const detectUrgency = (text: string): Detection => run(text, URGENCY_PATTERNS);
