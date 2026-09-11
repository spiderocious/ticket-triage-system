import { SCORE_PRECISION } from "../core/constants.js";
import type { Inputs, RetrievalRecord, RetrievedDoc, Ticket } from "../core/types.js";
import { normalizeText, stem, tokenize } from "./normalize.js";
import { expandQuery } from "./synonyms.js";
import { buildIndex, cosine, type TfIdfIndex } from "./tfidf.js";

export { normalizeText, stem, tokenize } from "./normalize.js";
export { expandQuery } from "./synonyms.js";
export { buildIndex } from "./tfidf.js";

export function roundScore(x: number): number {
  return Number(x.toFixed(SCORE_PRECISION));
}

/** Score every doc for one ticket. match_reasons are a by-product of what actually contributed to the score. */
export function retrieveForTicket(index: TfIdfIndex, ticket: Ticket, topK: number): RetrievedDoc[] {
  const rawTokens = tokenize(`${ticket.subject} ${ticket.message}`);
  const base = rawTokens.map(stem);
  const { expanded, fired } = expandQuery(base);
  const baseSet = new Set(base);
  const categoryTokens = new Set(expanded);

  const scored: RetrievedDoc[] = [];
  for (const d of index.docs) {
    const score = roundScore(cosine(index, d, expanded));
    const reasons: string[] = [];
    const docTerms = d.tf;
    for (const t of [...baseSet].sort()) if (docTerms.has(t)) reasons.push(`keyword: ${t}`);
    const firedSeen = new Set<string>();
    for (const f of fired) {
      const key = `${f.from}→${f.to}`;
      if (!firedSeen.has(key) && docTerms.has(f.to) && !baseSet.has(f.to)) {
        firedSeen.add(key);
        reasons.push(`synonym: ${key}`);
      }
    }
    for (const tag of [...d.stemmedTags].sort()) if (baseSet.has(tag)) reasons.push(`tag: ${tag}`);
    const cat = normalizeText(d.doc.category);
    if (cat.some((c) => categoryTokens.has(c))) reasons.push(`category: ${d.doc.category}`);
    if (score === 0 && reasons.length === 0) continue;
    if (reasons.length === 0) {
      const shared = [...docTerms.keys()].filter((t) => categoryTokens.has(t)).sort()[0];
      reasons.push(`overlap: ${shared ?? "weak lexical overlap"}`);
    }
    scored.push({ doc_id: d.doc.doc_id, score, match_reasons: [...new Set(reasons)] });
  }
  scored.sort((a, b) => b.score - a.score || a.doc_id.localeCompare(b.doc_id));
  if (scored.length === 0) {
    // Every ticket must cite something: the schema requires a non-empty retrieved_doc_ids, and a citation-free
    // response cannot be traced. A zero score still reads as weak evidence downstream, so this never auto-answers.
    const first = index.docs[0];
    if (first) return [{ doc_id: first.doc.doc_id, score: 0, match_reasons: ["fallback: no lexical overlap with any document"] }];
  }
  return scored.slice(0, topK);
}

/**
 * Retrieve top-k docs for every ticket, in ticket input order.
 * Sorted score desc, then doc_id asc. Scores rounded to SCORE_PRECISION. Every kept doc has >=1 match_reason.
 */
export function retrieveAll(inputs: Inputs, topK: number): RetrievalRecord[] {
  const index = buildIndex(inputs.kb);
  return inputs.tickets.map((t) => ({ ticket_id: t.ticket_id, retrieved: retrieveForTicket(index, t, topK) }));
}
