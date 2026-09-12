import { STRONG_EVIDENCE_BAR, WEAK_EVIDENCE_FLOOR, WEAK_EVIDENCE_MARGIN } from "../core/constants.js";
import type { RetrievalRecord } from "../core/types.js";

export interface EvidenceAssessment {
  weak: boolean;
  /** Deterministic 0..1: the top retrieval score, clamped. 0 when nothing was retrieved. */
  confidence: number;
  reason: string;
  /** Machine-readable trigger, for fallback_analysis.json. */
  trigger: "no_documents" | "below_floor" | "ambiguous_top_two" | "near_threshold" | "sufficient";
  top_score: number;
  second_score: number | null;
  /** top_score - second_score, rounded; null when there is no runner-up. */
  margin: number | null;
}

const round4 = (n: number): number => Number(n.toFixed(4));

export function assessEvidence(retrieval: RetrievalRecord): EvidenceAssessment {
  const [top, second] = retrieval.retrieved;
  if (!top) {
    return { weak: true, confidence: 0, reason: "no documents retrieved", trigger: "no_documents", top_score: 0, second_score: null, margin: null };
  }
  const confidence = round4(Math.min(1, Math.max(0, top.score)));
  const top_score = top.score;
  const second_score = second ? second.score : null;
  const margin = second ? round4(top.score - second.score) : null;
  const base = { confidence, top_score, second_score, margin };

  if (top.score < WEAK_EVIDENCE_FLOOR) {
    return { ...base, weak: true, trigger: "below_floor", reason: `top score ${top.score} below floor ${WEAK_EVIDENCE_FLOOR}` };
  }
  if (second && top.score - second.score < WEAK_EVIDENCE_MARGIN && top.score < STRONG_EVIDENCE_BAR) {
    return { ...base, weak: true, trigger: "ambiguous_top_two", reason: `ambiguous: top two scores within ${WEAK_EVIDENCE_MARGIN} and top below ${STRONG_EVIDENCE_BAR}` };
  }
  // Not weak enough to downgrade, but close enough to the bar that the run should say so rather than stay silent.
  if (top.score < STRONG_EVIDENCE_BAR) {
    return { ...base, weak: false, trigger: "near_threshold", reason: `top score ${top.score} clears the floor but sits below the strong-evidence bar ${STRONG_EVIDENCE_BAR}` };
  }
  return { ...base, weak: false, trigger: "sufficient", reason: `top score ${top.score} at or above the strong-evidence bar ${STRONG_EVIDENCE_BAR}` };
}
