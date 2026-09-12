# Required Artifacts & Schemas

Every path is relative to the repo root. The evaluator may replace the three input files with equivalent fixtures using the same schema.

---

## Inputs (read from disk)

### `tickets.json`
Array of objects.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Unique. Never hardcode specific values. |
| `created_at` | string | ISO-8601 UTC. |
| `channel` | string | e.g. `chat`, `email`. |
| `language` | string | e.g. `en`. |
| `customer_tier` | string | e.g. `standard`, `vip`. |
| `subject` | string | |
| `message` | string | |

### `knowledge_base.json`
Array of objects.

| Field | Type | Notes |
|---|---|---|
| `doc_id` | string | Unique. |
| `title` | string | |
| `category` | string | e.g. `payments`, `security`, `privacy`. |
| `content` | string | |
| `tags` | string[] | |

### `response_policy.json`
Single object.

| Field | Type | Notes |
|---|---|---|
| `allowed_decisions` | string[] | `auto_answer`, `needs_human_review`, `refuse_and_redirect`. |
| `allowed_risk_levels` | string[] | `low`, `medium`, `high`, `critical`. |
| `required_output_fields` | string[] | Field names every `triage_results.json` record must carry. |
| `rules` | object | Boolean flags, listed below. |

Policy rule flags:

- `must_not_claim_account_specific_data`
- `must_not_promise_unverified_timeframes`
- `security_sensitive_topics_require_review`
- `privacy_sensitive_requests_must_be_redirected`

Read the allowed values from this file at runtime. Do not hardcode the enums.

---

## Outputs (written to disk)

### `retrieval_results.json`
Array, one record per ticket.

```json
{
  "ticket_id": "t001",
  "retrieved": [
    {
      "doc_id": "kb_001",
      "score": 0.91,
      "match_reasons": ["withdrawal keyword", "delay synonym"]
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Must match a ticket in `tickets.json`. |
| `retrieved` | array | Ranked, highest score first. Tie-break on `doc_id` ascending for reproducibility. |
| `retrieved[].doc_id` | string | Must exist in `knowledge_base.json`. |
| `retrieved[].score` | number | Deterministic. Round to fixed precision so reruns are byte-identical. |
| `retrieved[].match_reasons` | string[] | Human-readable. Non-empty for every retrieved doc. |

### `routing_signals.json`
Array, one record per ticket. Each signal carries its own evidence.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | |
| `asks_for_account_specific_data` | boolean | |
| `is_security_sensitive` | boolean | |
| `asks_for_guaranteed_timeline` | boolean | |
| `evidence_is_weak_or_missing` | boolean | |
| `safe_for_auto_answer` | boolean | |
| `matched_phrases` | string[] | Literal spans found in the ticket text. |
| `triggered_rules` | string[] | Policy rule keys from `response_policy.json`. |
| `relevant_doc_ids` | string[] | Subset of the ticket's retrieved doc IDs. |

Each of the five booleans must be traceable to at least one entry in `matched_phrases`, `triggered_rules`, or `relevant_doc_ids`.

### `triage_results.json`
Array, one record per ticket. Field list is driven by `required_output_fields` in the policy.

```json
{
  "ticket_id": "t001",
  "decision": "auto_answer",
  "risk_level": "medium",
  "retrieved_doc_ids": ["kb_001"],
  "policy_references": ["must_not_promise_unverified_timeframes"],
  "customer_response": "string",
  "internal_reasoning_summary": "string"
}
```

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | |
| `decision` | string | Must be in `allowed_decisions`. Computed in code, never by the LLM. |
| `risk_level` | string | Must be in `allowed_risk_levels`. |
| `retrieved_doc_ids` | string[] | Must be non-empty and match `retrieval_results.json` for this ticket. |
| `policy_references` | string[] | Must be non-empty. Keys from `response_policy.json` → `rules`. |
| `customer_response` | string | LLM-drafted, safety-validated. |
| `internal_reasoning_summary` | string | LLM-drafted, safety-validated. |

### `llm_calls.jsonl`
One JSON object per line, one line per LLM call.

```json
{
  "stage": "response_generation",
  "ticket_id": null,
  "timestamp": "ISO-8601 timestamp",
  "provider": "string",
  "model": "string",
  "prompt_hash": "string",
  "input_artifacts": ["tickets.json", "knowledge_base.json", "response_policy.json", "retrieval_results.json", "routing_signals.json"],
  "output_artifact": "triage_results.json"
}
```

| Field | Type | Notes |
|---|---|---|
| `stage` | string | e.g. `response_generation`, `response_repair`. |
| `ticket_id` | string \| null | `null` for the combined all-ticket call. |
| `timestamp` | string | ISO-8601. |
| `provider` | string | |
| `model` | string | |
| `prompt_hash` | string | Stable hash of the exact prompt sent. |
| `input_artifacts` | string[] | Files that fed the prompt. |
| `output_artifact` | string | File the result was written to. |

A repair retry is a second call and gets its own line.

### `fallback_analysis.json`
Array, one record per ticket that was downgraded, flagged as near-threshold, or had its text substituted. Empty array
when every ticket retrieved strong evidence and every draft passed the safety gate first time.

```json
{
  "ticket_id": "adv-irrelevant-kb",
  "retrieval_confidence": 0.0705,
  "original_decision": "auto_answer",
  "final_decision": "needs_human_review",
  "reason_not_auto_sent": "retrieval evidence was weak or missing (confidence 0.0705), so the ticket was downgraded from auto_answer to needs_human_review",
  "top_score": 0.0705,
  "second_score": 0.0503,
  "margin": 0.0202,
  "trigger": "below_floor",
  "action_taken": "downgraded_to_needs_human_review"
}
```

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Must match a ticket in `tickets.json`. |
| `retrieval_confidence` | number | Deterministic, derived from retrieval scores. The top score, clamped to 0..1. |
| `original_decision` | string | Decision before the fallback applied. |
| `final_decision` | string | Decision after the fallback applied. Equals `original_decision` when only the text was substituted. |
| `reason_not_auto_sent` | string | Human-readable explanation, semicolon-separated when several causes applied. |
| `top_score` | number | Highest retrieval score for this ticket, or `0` when nothing was retrieved. |
| `second_score` | number \| null | Runner-up score, or `null` when fewer than two documents were retrieved. |
| `margin` | number \| null | `top_score - second_score`, or `null` when there is no runner-up. A narrow margin means an ambiguous match. |
| `trigger` | string | Which condition fired. One of the values below. |
| `action_taken` | string | What the pipeline did in response. |

**`trigger` values**

| Value | Meaning |
|---|---|
| `no_documents` | Retrieval returned nothing at all. |
| `below_floor` | Top score below `WEAK_EVIDENCE_FLOOR` (0.10). |
| `ambiguous_top_two` | Top two within `WEAK_EVIDENCE_MARGIN` (0.05) and top below `STRONG_EVIDENCE_BAR` (0.35). |
| `near_threshold` | Cleared the floor but below the strong-evidence bar. Recorded for visibility; does not downgrade. |
| `template_substituted` | The drafted and repaired text both failed the safety gate. |

**`action_taken` values**

| Value | Meaning |
|---|---|
| `downgraded_to_needs_human_review` | The weak-evidence ladder row overrode a more permissive decision. |
| `recorded_only` | No decision change. Logged so thin or merely adequate retrieval is visible to a reviewer, either because the match sat below the strong-evidence bar or because a higher-priority safety rule had already claimed the ticket. |
| `template_substituted` | Model text replaced with a deterministic template built from the decision and cited documents. |

A single ticket can hit more than one condition. `trigger` and `action_taken` carry the most consequential one,
while `reason_not_auto_sent` lists every cause that applied.

**Weak evidence without a downgrade.** The ladder is ordered, so a privacy or security row can claim a ticket before
the weak-evidence row is reached. The decision is then already restrictive and nothing is downgraded, but the retrieval
behind it was still thin. Those tickets get a record with the evidence trigger (`below_floor`, `ambiguous_top_two`, or
`no_documents`) and action `recorded_only`. Omitting them would hide the weakest retrievals in the run purely because a
stricter rule happened to fire first.

An empty array is a valid and meaningful result: it means every ticket retrieved strong evidence and every draft passed
the safety gate on the first attempt.

### `design_notes.md`
Prose. Must cover:

- retrieval approach and tradeoffs
- deterministic vs model-owned responsibilities
- key safety failure modes
- what to improve for production scale, observability, and monitoring

### `validate.py` or equivalent
A single command entry point. Contents specified in `validation-checklist.md`.

---

## Cross-artifact invariants

- Every `ticket_id` in `tickets.json` appears exactly once in `retrieval_results.json`, `routing_signals.json`, and `triage_results.json`.
- Every `doc_id` referenced in any output exists in `knowledge_base.json`.
- `retrieved_doc_ids` in `triage_results.json` matches the `retrieved` list for that ticket in `retrieval_results.json`.
- `decision` in `triage_results.json` equals the decision re-derived from `routing_signals.json` plus the policy.
- Re-running the pipeline on unchanged inputs produces identical deterministic artifacts.
