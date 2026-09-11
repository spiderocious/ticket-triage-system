import { STRONG_EVIDENCE_BAR, WEAK_EVIDENCE_FLOOR, WEAK_EVIDENCE_MARGIN } from "../core/constants.js";
import type { RetrievalRecord } from "../core/types.js";

export interface EvidenceAssessment {
  weak: boolean;
  /** Deterministic 0..1: the top retrieval score, clamped. 0 when nothing was retrieved. */
  confidence: number;
  reason: string;
}

export function assessEvidence(retrieval: RetrievalRecord): EvidenceAssessment {
  const [top, second] = retrieval.retrieved;
  if (!top) return { weak: true, confidence: 0, reason: "no documents retrieved" };
  const confidence = Number(Math.min(1, Math.max(0, top.score)).toFixed(4));
  if (top.score < WEAK_EVIDENCE_FLOOR) {
    return { weak: true, confidence, reason: `top score ${top.score} below floor ${WEAK_EVIDENCE_FLOOR}` };
  }
  if (second && top.score - second.score < WEAK_EVIDENCE_MARGIN && top.score < STRONG_EVIDENCE_BAR) {
    return { weak: true, confidence, reason: `ambiguous: top two scores within ${WEAK_EVIDENCE_MARGIN} and top below ${STRONG_EVIDENCE_BAR}` };
  }
  return { weak: false, confidence, reason: `top score ${top.score} at or above floor ${WEAK_EVIDENCE_FLOOR}` };
}
