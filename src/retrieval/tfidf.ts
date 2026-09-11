import type { KbDoc } from "../core/types.js";
import { normalizeText } from "./normalize.js";

export interface IndexedDoc {
  doc: KbDoc;
  tokens: string[];
  tf: Map<string, number>;
  norm: number;
  stemmedTags: Set<string>;
}

export interface TfIdfIndex {
  docs: IndexedDoc[];
  idf: Map<string, number>;
}

/** Docs are iterated in doc_id order so every derived structure is deterministic. */
export function buildIndex(kb: KbDoc[]): TfIdfIndex {
  const sorted = [...kb].sort((a, b) => a.doc_id.localeCompare(b.doc_id));
  const df = new Map<string, number>();
  const pre = sorted.map((doc) => {
    const tokens = normalizeText(`${doc.title} ${doc.content} ${doc.tags.join(" ")}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const stemmedTags = new Set(doc.tags.flatMap((tag) => normalizeText(tag)));
    return { doc, tokens, tf, stemmedTags };
  });
  const n = sorted.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)) + 1);
  const docs: IndexedDoc[] = pre.map((p) => {
    const len = p.tokens.length || 1;
    let sumsq = 0;
    for (const [t, c] of p.tf) {
      const w = (c / len) * (idf.get(t) ?? 1);
      sumsq += w * w;
    }
    return { ...p, norm: Math.sqrt(sumsq) || 1 };
  });
  return { docs, idf };
}

export function cosine(index: TfIdfIndex, d: IndexedDoc, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const qtf = new Map<string, number>();
  for (const t of queryTokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);
  const qlen = queryTokens.length;
  let dot = 0;
  let qsum = 0;
  const dlen = d.tokens.length || 1;
  for (const [t, c] of qtf) {
    const idf = index.idf.get(t) ?? 1;
    const qw = (c / qlen) * idf;
    qsum += qw * qw;
    const dc = d.tf.get(t);
    if (dc) dot += qw * (dc / dlen) * idf;
  }
  const qnorm = Math.sqrt(qsum) || 1;
  return dot / (qnorm * d.norm);
}
