import { stem } from "./normalize.js";

/** Curated synonym bridge. Left side: stemmed ticket token. Right side: stemmed terms to add to the query. */
const RAW_SYNONYMS: Record<string, string[]> = {
  delayed: ["review", "processing", "pending", "timeline", "verification"],
  delay: ["review", "processing", "pending", "timeline", "verification"],
  pending: ["review", "processing", "delayed", "timeline"],
  stuck: ["review", "processing", "pending", "delayed"],
  waiting: ["review", "processing", "pending"],
  slow: ["review", "processing", "delayed"],
  late: ["review", "processing", "delayed"],
  complete: ["processing", "timeline", "review"],
  withdraw: ["withdrawal", "payment", "payout", "processing"],
  withdrawal: ["withdraw", "payment", "payout", "processing"],
  payout: ["withdrawal", "payment"],
  cashout: ["withdrawal", "payment"],
  "2fa": ["security", "verification", "authentication", "device"],
  "two-factor": ["2fa", "security", "verification"],
  twofactor: ["2fa", "security", "verification"],
  authenticator: ["2fa", "security", "verification", "device"],
  otp: ["2fa", "security", "verification"],
  mfa: ["2fa", "security", "verification"],
  reset: ["procedure", "verification", "security"],
  phone: ["device", "2fa"],
  device: ["2fa", "phone", "security"],
  password: ["security", "verification", "identity"],
  login: ["security", "verification", "identity"],
  locked: ["security", "verification", "identity"],
  hacked: ["security", "verification", "unusual"],
  compromised: ["security", "verification", "unusual"],
  balance: ["account", "financial", "privacy", "data"],
  transaction: ["history", "financial", "privacy", "data", "account"],
  statement: ["transaction", "history", "financial", "account"],
  history: ["transaction", "financial", "account"],
  funds: ["balance", "financial", "account"],
  money: ["balance", "financial", "payment"],
  deposit: ["payment", "transaction", "processing"],
  verify: ["verification", "identity", "security"],
  verification: ["identity", "security", "review"],
  kyc: ["verification", "identity"],
  identity: ["verification", "security"],
  refund: ["payment", "processing", "review"],
  fee: ["payment", "processing"],
  charge: ["payment", "transaction"],
};

const SYNONYMS = new Map<string, string[]>(Object.entries(RAW_SYNONYMS).map(([k, vs]) => [stem(k), [...new Set(vs.map(stem))]]));

export interface SynonymFire {
  from: string;
  to: string;
}

export function expandQuery(tokens: string[]): { expanded: string[]; fired: SynonymFire[] } {
  const expanded = [...tokens];
  const fired: SynonymFire[] = [];
  const seen = new Set(tokens);
  for (const t of tokens) {
    const targets = SYNONYMS.get(t);
    if (!targets) continue;
    for (const to of targets) {
      fired.push({ from: t, to });
      if (!seen.has(to)) {
        seen.add(to);
        expanded.push(to);
      }
    }
  }
  return { expanded, fired };
}
