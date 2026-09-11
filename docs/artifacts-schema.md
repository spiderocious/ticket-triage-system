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
Array, one record per ticket that was downgraded or flagged.

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | |
| `retrieval_confidence` | number | Deterministic, derived from retrieval scores. |
| `original_decision` | string | Decision before the fallback applied. |
| `final_decision` | string | Decision after the fallback applied. |
| `reason_not_auto_sent` | string | Why the answer was not auto-sent. |

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
