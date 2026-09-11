# Triage Pipeline — Full Spec

Merged from `features.md` (problem + scope), `system-design.md` (architecture),
`artifacts-schema.md` (schemas + invariants), and `mvp-list.md` (acceptance stories).
This is the single source of truth. `stack.md` and `backend-engineer-skill.md` remain separate
(stack choice and engineering persona respectively); `todo.md` remains the execution plan.

Priority when two sections conflict: **§2 scope** (the brief) wins over **§3 architecture**
(our interpretation of it). Anything marked *Locked decision* resolves a conflict deliberately.

---

## 1. Problem statement

Build a small, replayable AI support-triage service for a product team that needs safe,
consistent answers from internal help content.

The service ingests support tickets and a small knowledge base from local files, retrieves
relevant policy snippets deterministically, decides whether the ticket can be answered
automatically, and generates an auditable response package.

This is not a prompt-only task. The evaluator will run the project from a clean checkout and
may replace the input files with equivalent fixtures using the same schema. The implementation
must not depend on hardcoded ticket IDs, fixed output text, or manual review steps.

The goal is to show practical AI engineering judgment: deterministic preprocessing, bounded
model use, validation, fallback behavior, and clear evidence for every model-assisted decision.

### Technical constraints (from the brief)

- Retrieval and routing decisions must be implemented deterministically in code.
- The LLM may draft text, but it must not own the final routing decision.
- Final outputs must be reproducible from the same inputs.
- The implementation must handle evaluator-provided files with the same schema.
- Do not require secrets or private services to understand the solution.
- Do not use hidden manual review steps.
- Keep the solution runnable from a clean checkout.
- Do not expose or invent account-specific customer data.
- Do not rely on a single prompt without validation or guardrails.

---

## 2. Scope

### 2.1 MUST — Deterministic retrieval preparation

Implement deterministic preprocessing in code. Do not ask an LLM to decide what documents
exist or to fabricate citations.

The pipeline must: load and validate all input files; normalize ticket and document text;
build a deterministic retrieval method for the knowledge base; retrieve the top relevant
documents for each ticket; save retrieval evidence to `retrieval_results.json`.

Keyword scoring, TF-IDF, embeddings with deterministic ranking, or another documented method
are all permitted. If embeddings are used, the final selection logic must still be explicit
and reproducible.

### 2.2 MUST — Rule-based risk and routing signals

Before any LLM response generation, compute deterministic routing signals in code. For each
ticket, derive at least:

- `asks_for_account_specific_data`
- `is_security_sensitive`
- `asks_for_guaranteed_timeline`
- `evidence_is_weak_or_missing`
- `safe_for_auto_answer`

Save to `routing_signals.json`. Each record must include supporting evidence: matched phrases,
triggered rules, and relevant retrieved document IDs.

### 2.3 MUST — Response decision and controlled LLM use

Use deterministic code plus the response policy to assign one of `auto_answer`,
`needs_human_review`, `refuse_and_redirect`. The decision must be reproducible and implemented
in code. The LLM must not invent the final routing decision.

Then make **one combined LLM call** to draft customer-facing responses and concise internal
summaries for all tickets, using: the original ticket, retrieved snippets, routing signals, the
deterministic decision, and the response policy.

LLM output must be validated against the allowed decisions and risk levels, and against the
deterministic decision already computed in code. Save to `triage_results.json`.

### 2.4 MUST — Safe response constraints

Generated customer responses must:

- not provide account-specific balances, transactions, or personal data
- not promise an exact resolution time unless policy and evidence allow it
- not disable or bypass security procedures
- use the retrieved knowledge base as the basis for the answer
- when refusing or escalating, explain the next step clearly and politely

### 2.5 MUST — Validation command

A single validation entry point (`python validate.py`, `make validate`, or equivalent). It must
check that:

- required artifacts exist
- JSON files are valid
- every ticket has retrieval results, routing signals, and a final result
- final decisions match the deterministic routing logic
- only allowed decisions and risk levels are used
- every final result contains retrieved document IDs and policy references
- responses for privacy-sensitive requests do not disclose account-specific data
- responses for timeline questions do not promise unsupported exact completion times
- LLM output structure is validated before finalization

> `artifacts-schema.md` referenced a `validation-checklist.md` that does not exist. **This list
> is the validation checklist.**

### 2.6 SHOULD — Low-evidence fallback

If retrieval quality is weak, avoid confident answering: downgrade to `needs_human_review`, add
a retrieval-confidence field, record why the answer was not auto-sent. Save to
`fallback_analysis.json`.

### 2.7 SHOULD — Adversarial and edge-case tests

Cover: irrelevant retrieved documents; mixed-intent tickets; a privacy-sensitive request
phrased indirectly; a security request combined with urgency language.

### 2.8 SHOULD — Prompt and output hardening

Output validation or repair logic so malformed model output does not silently pass through.

### 2.9 STRETCH — Explainability artifact

`design_notes.md` covering retrieval approach and tradeoffs, deterministic vs model-owned
responsibilities, key safety failure modes, and what to improve for production scale,
observability, and monitoring.

### 2.10 STRETCH — Minimal service interface

A tiny local API or CLI, e.g. `--tickets … --kb … --policy …`.

---

## 3. Architecture

TypeScript + Node 20+ + the `openai` SDK. Code owns every decision; the model writes prose and
nothing else.

### 3.1 The load-bearing constraint

| Owned by code | Owned by the model |
|---|---|
| Which documents are relevant, and their scores | `customer_response` text |
| Whether the ticket asks for account data | `internal_reasoning_summary` text |
| Whether the topic is security-sensitive | |
| Whether a guaranteed timeline was requested | |
| Whether evidence is strong enough | |
| **The final decision and risk level** | |

That is the entire model column. The decision reaches the model as *a fact it must express*,
never as a question it may answer.

### 3.2 Does this need a model at all?

Yes, but less than the brief first suggests. §2.3 allows exactly one combined call drafting two
strings per ticket. Retrieval must be deterministic; the routing decision must be reproducible
from code. So the model is a **renderer at the tail of a pipeline that already decided
everything**.

That makes Node comfortable: the deterministic half is string processing — tokenize, TF-IDF,
regex rules — with no numerical libraries needed. Python would buy scikit-learn we wouldn't use.

**Determinism caveat:** model prose is not byte-reproducible, and the spec doesn't require it.
What must be reproducible are the *decisions* — computed before the call, re-derived
independently by the validator. We set `temperature: 0` and a fixed `seed` anyway.

### 3.3 Pipeline

| # | Stage | Owner | Writes |
|---|---|---|---|
| 1 | **Load & validate** — zod parse, reject unknown shapes, read enums from policy | code | — |
| 2 | **Normalize & index** — lowercase, strip, stopwords, TF-IDF over `title + content + tags` | code | — |
| 3 | **Retrieve** — score, expand synonyms, sort by score desc / `doc_id` asc | code | `retrieval_results.json` |
| 4 | **Signal & decide** — five booleans with evidence, then the ladder | code | `routing_signals.json` |
| 5 | **Draft** — one call, all tickets, Structured Outputs | **model** | `llm_calls.jsonl` |
| 6 | **Gate & write** — safety validators, repair, fallback | code | `triage_results.json` |

The decision is final at stage 4. Nothing downstream may alter it.

### 3.4 Retrieval: TF-IDF with a synonym bridge

Classic TF-IDF with cosine similarity, ~50 lines, no dependencies. Plain term overlap fails the
obvious case: *"my withdrawal is delayed"* shares no term with *"Withdrawal review timeline."*

So query terms expand through a curated synonym map (`delayed → pending, review, processing`)
before scoring, and the expansion that fired becomes the `match_reasons` entry — a byproduct of
the algorithm, not narration bolted on after.

**Tradeoff:** the map is hand-built, covers the given domain, degrades to plain TF-IDF outside
it. Stage 4 catches the failure — below-threshold scores mark weak evidence and never
auto-answer. Embeddings would generalize better but would put a network call inside the
deterministic half, which is what the brief argues against.

### 3.5 The decision ladder

First match wins, evaluated top to bottom. Ordering is the whole design — safety rules sit above
the permissive one, so a mixed-intent ticket resolves to the restrictive branch.

| # | Condition | Decision | Risk |
|---|---|---|---|
| 1 | Asks for account-specific data | `refuse_and_redirect` | high |
| 2 | Security-sensitive topic | `needs_human_review` | high |
| 3 | Evidence weak or missing | `needs_human_review` | medium |
| 4 | Asks for a guaranteed timeline | `auto_answer` | medium |
| 5 | Otherwise | `auto_answer` | low |

Row 4 is the interesting one: a timeline request doesn't *block* an answer, it constrains what
the answer may say. The ticket auto-answers, but `must_not_promise_unverified_timeframes` is
attached to `policy_references`, passed to the model as a hard instruction, and checked again at
stage 6.

**Trap:** the three sample tickets map one-to-one onto the three decisions. Rules that fit those
three can fail the evaluator's fixtures. Every rule keys on phrase patterns and document
categories, never a ticket ID — and tests run against a second fixture set with different IDs.

### 3.6 Constraining the call

The response schema is the primary guardrail. The model isn't *trusted* to omit a decision
field — it has no such field to fill.

```ts
const Draft = z.object({
  drafts: z.array(z.object({
    ticket_id: z.string(),
    customer_response: z.string().min(40),
    internal_reasoning_summary: z.string().min(20),
  }))
});
// no `decision`, no `risk_level` — not the model's to give

const res = await client.chat.completions.parse({
  model: "gpt-4o-2024-08-06",
  temperature: 0,
  seed: 7,
  response_format: zodResponseFormat(Draft, "drafts"),
  messages: [ system, user ],
});
```

After parsing, ticket IDs reconcile against the input set. A missing ticket, duplicate, or
unknown ID is a hard failure — not a silent gap.

### 3.7 The safety gate

Structural validity isn't safety. A well-formed string can still quote a balance or promise
delivery by Tuesday. Each draft runs through content validators derived from the same signals
that produced the decision:

- Privacy-flagged ticket → no currency figures, no transaction language
- Timeline-flagged ticket → no exact-duration promise (`/\b(within|in|by)\s+\d+\s*(hour|day|minute)/i` and relatives)
- No response may offer to disable, bypass, or skip verification
- Every refusal or escalation must state a next step

**On failure:** one repair call naming the specific violation, logged as its own
`llm_calls.jsonl` record with stage `response_repair`. If the rewrite also fails, substitute a
deterministic template built from the decision and retrieved documents. Output quality drops;
safety doesn't. The run still succeeds, and the substitution is recorded.

### 3.8 Repository layout

```
src/
  io/          — zod schemas, file read/write
  retrieval/   — normalize, tfidf, synonyms, rank
  signals/     — phrase rules, evidence scoring
  decide/      — the ladder (pure, shared with validator)
  llm/         — prompt, client, call log
  gate/        — content validators, repair, templates
  pipeline.ts, cli.ts, validate.ts
fixtures/      — adversarial + alternate-ID sets
tests/
```

`decide/` is imported by both the pipeline and the validator. The validator re-runs it from raw
inputs and compares against what was written — so drift is caught, not rubber-stamped.

### 3.9 Running it

```bash
npm start                          # defaults to ./tickets.json etc.
npm start -- --tickets ./fixtures/alt/tickets.json \
             --kb ./fixtures/alt/knowledge_base.json \
             --policy ./response_policy.json
npm run validate                   # independent re-derivation
npm test                           # adversarial + edge-case suite
```

`validate` and `test` need no key — they operate on artifacts and pure functions, so the
deterministic half is verifiable without spending a token.

> *Locked decision — offline provider.* The original design said `OPENAI_API_KEY` is required
> and `npm start` exits naming it. §1 and §5 require the whole pipeline to run with no secret.
> Resolution: `LLM_PROVIDER=openai|mock` selects the provider. `mock` is a deterministic template
> renderer that goes through the same schema, gate, and call log. See `todo.md` for the default.

---

## 4. Data contracts

Every path is relative to the repo root. The evaluator may replace the three input files with
equivalent fixtures using the same schema.

### 4.1 Inputs

#### `tickets.json` — array of objects

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Unique. Never hardcode specific values. |
| `created_at` | string | ISO-8601 UTC. |
| `channel` | string | e.g. `chat`, `email`. |
| `language` | string | e.g. `en`. |
| `customer_tier` | string | e.g. `standard`, `vip`. |
| `subject` | string | |
| `message` | string | |

```json
[
  {
    "ticket_id": "t001",
    "created_at": "2025-08-04T09:14:00Z",
    "channel": "chat",
    "language": "en",
    "customer_tier": "standard",
    "subject": "Why was my withdrawal delayed?",
    "message": "My withdrawal has been pending for 18 hours. Can you tell me why and when it will complete?"
  },
  {
    "ticket_id": "t002",
    "created_at": "2025-08-04T10:02:00Z",
    "channel": "email",
    "language": "en",
    "customer_tier": "vip",
    "subject": "Reset 2FA after losing phone",
    "message": "I no longer have access to my phone and need help resetting 2FA on my account."
  },
  {
    "ticket_id": "t003",
    "created_at": "2025-08-04T10:15:00Z",
    "channel": "chat",
    "language": "en",
    "customer_tier": "standard",
    "subject": "Tell me my account balance",
    "message": "Please tell me my current account balance and last 5 transactions."
  }
]
```

#### `knowledge_base.json` — array of objects

| Field | Type | Notes |
|---|---|---|
| `doc_id` | string | Unique. |
| `title` | string | |
| `category` | string | e.g. `payments`, `security`, `privacy`. |
| `content` | string | |
| `tags` | string[] | |

```json
[
  {
    "doc_id": "kb_001",
    "title": "Withdrawal review timeline",
    "category": "payments",
    "content": "Withdrawals may be delayed for manual review, verification checks, payment partner processing, or unusual account activity. Support agents must not promise a completion time unless status is confirmed in back-office tools. Typical review windows are up to 24 hours, but exceptions exist.",
    "tags": ["withdrawal", "manual review", "processing"]
  },
  {
    "doc_id": "kb_002",
    "title": "2FA reset procedure",
    "category": "security",
    "content": "If a customer loses access to their 2FA device, support must route the case to identity verification. Agents must not disable 2FA directly through chat or email without the documented verification flow.",
    "tags": ["2fa", "security", "verification"]
  },
  {
    "doc_id": "kb_003",
    "title": "Account-specific data access policy",
    "category": "privacy",
    "content": "Agents and automated systems must not provide account balance, transaction history, or other account-specific financial data unless the request is fulfilled through authenticated product surfaces or approved secure workflows.",
    "tags": ["balance", "transactions", "privacy"]
  }
]
```

#### `response_policy.json` — single object

| Field | Type | Notes |
|---|---|---|
| `allowed_decisions` | string[] | `auto_answer`, `needs_human_review`, `refuse_and_redirect`. |
| `allowed_risk_levels` | string[] | `low`, `medium`, `high`, `critical`. |
| `required_output_fields` | string[] | Field names every `triage_results.json` record must carry. |
| `rules` | object | Boolean flags. |

Policy rule flags: `must_not_claim_account_specific_data`,
`must_not_promise_unverified_timeframes`, `security_sensitive_topics_require_review`,
`privacy_sensitive_requests_must_be_redirected`.

**Read the allowed values from this file at runtime. Do not hardcode the enums.**

```json
{
  "allowed_decisions": ["auto_answer", "needs_human_review", "refuse_and_redirect"],
  "allowed_risk_levels": ["low", "medium", "high", "critical"],
  "required_output_fields": [
    "ticket_id", "decision", "risk_level", "retrieved_doc_ids",
    "policy_references", "customer_response", "internal_reasoning_summary"
  ],
  "rules": {
    "must_not_claim_account_specific_data": true,
    "must_not_promise_unverified_timeframes": true,
    "security_sensitive_topics_require_review": true,
    "privacy_sensitive_requests_must_be_redirected": true
  }
}
```

### 4.2 Outputs

#### `retrieval_results.json` — array, one record per ticket

```json
{
  "ticket_id": "t001",
  "retrieved": [
    { "doc_id": "kb_001", "score": 0.91, "match_reasons": ["withdrawal keyword", "delay synonym"] }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | Must match a ticket in `tickets.json`. |
| `retrieved` | array | Ranked, highest score first. Tie-break on `doc_id` ascending. |
| `retrieved[].doc_id` | string | Must exist in `knowledge_base.json`. |
| `retrieved[].score` | number | Deterministic. Round to fixed precision so reruns are byte-identical. |
| `retrieved[].match_reasons` | string[] | Human-readable. Non-empty for every retrieved doc. |

#### `routing_signals.json` — array, one record per ticket

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

Each of the five booleans must be traceable to at least one entry in `matched_phrases`,
`triggered_rules`, or `relevant_doc_ids`.

#### `triage_results.json` — array, one record per ticket

Field list is driven by `required_output_fields` in the policy.

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
| `retrieved_doc_ids` | string[] | Non-empty; matches `retrieval_results.json` for this ticket. |
| `policy_references` | string[] | Non-empty. Keys from `response_policy.json` → `rules`. |
| `customer_response` | string | LLM-drafted, safety-validated. |
| `internal_reasoning_summary` | string | LLM-drafted, safety-validated. |

#### `llm_calls.jsonl` — one JSON object per line, one line per LLM call

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

#### `fallback_analysis.json` — array, one record per downgraded or flagged ticket

| Field | Type | Notes |
|---|---|---|
| `ticket_id` | string | |
| `retrieval_confidence` | number | Deterministic, derived from retrieval scores. |
| `original_decision` | string | Decision before the fallback applied. |
| `final_decision` | string | Decision after the fallback applied. |
| `reason_not_auto_sent` | string | Why the answer was not auto-sent. |

#### `design_notes.md`

Prose covering: retrieval approach and tradeoffs; deterministic vs model-owned
responsibilities; key safety failure modes; what to improve for production scale,
observability, and monitoring.

### 4.3 Cross-artifact invariants

Validation must check all of these:

- Every `ticket_id` in `tickets.json` appears exactly once in `retrieval_results.json`,
  `routing_signals.json`, and `triage_results.json`.
- Every `doc_id` referenced in any output exists in `knowledge_base.json`.
- `retrieved_doc_ids` in `triage_results.json` matches the `retrieved` list for that ticket in
  `retrieval_results.json`.
- `decision` in `triage_results.json` equals the decision re-derived from `routing_signals.json`
  plus the policy.
- Only allowed decisions and risk levels are used.
- Privacy-sensitive responses disclose no account-specific data.
- Timeline responses promise no unsupported exact completion times.
- LLM output structure is validated before finalization.
- Re-running the pipeline on unchanged inputs produces identical deterministic artifacts.

### 4.4 Expected behaviour on the sample data

Useful as a smoke test, but **never hardcode these outcomes**:

- withdrawal delay question → `auto_answer`, must not promise a completion time
- 2FA reset after losing device → `needs_human_review` (security-sensitive)
- balance / transaction request → `refuse_and_redirect` (privacy-sensitive)

---

## 5. Acceptance checklist

Every line is a user story from `mvp-list.md`, grouped by the pipeline stage it exercises.

### Running and input handling

- [ ] Run the pipeline from a clean checkout with a single command.
- [ ] Point the pipeline at `tickets.json`, `knowledge_base.json`, `response_policy.json` on disk.
- [ ] Swap in different input files with the same schema and have the pipeline work unchanged.
- [ ] See the pipeline fail clearly when an input file is missing, malformed, or violates the schema.
- [ ] Run the pipeline with explicit file paths via CLI flags.
- [ ] Run the whole pipeline without providing any secret or private service credential.

### Retrieval

- [ ] Get normalized ticket and document text before any scoring happens.
- [ ] Retrieve the top relevant knowledge base documents for every ticket deterministically.
- [ ] Read `retrieval_results.json` and see each ticket's retrieved doc IDs, scores, and match reasons.
- [ ] Re-run retrieval on the same inputs and get byte-identical results.

### Signals

- [ ] See, per ticket, whether the request asks for account-specific data.
- [ ] See, per ticket, whether the topic is security-sensitive.
- [ ] See, per ticket, whether the request asks for a guaranteed timeline.
- [ ] See, per ticket, whether the retrieved evidence is weak or missing.
- [ ] See, per ticket, whether the ticket is safe for automatic answering under policy.
- [ ] Read `routing_signals.json` and see the matched phrases, triggered rules, and relevant doc IDs behind every signal.

### Decision and LLM use

- [ ] Get exactly one decision per ticket from `auto_answer`, `needs_human_review`, `refuse_and_redirect`.
- [ ] Confirm the decision was computed in code, not chosen by the LLM.
- [ ] Have all customer responses and internal summaries drafted in one combined LLM call.
- [ ] Have the LLM output structurally validated before it is written to any artifact.
- [ ] Have LLM output rejected or repaired when it contradicts the deterministic decision or uses a disallowed decision or risk level.
- [ ] Read `triage_results.json` and see all seven required fields for every ticket.
- [ ] Read `llm_calls.jsonl` and see one record per LLM call with stage, ticket ID, timestamp, provider, model, prompt hash, input artifacts, and output artifact.

### Safety

- [ ] Trust that no customer response discloses account balances, transactions, or personal data.
- [ ] Trust that no customer response promises an exact resolution time unsupported by policy and evidence.
- [ ] Trust that no customer response disables or bypasses a security procedure.
- [ ] Trace every customer response back to the retrieved knowledge base documents.
- [ ] Read a clear next step in every refusal or escalation response.

### Validation

- [ ] Run a single validation command.
- [ ] Validation confirms all required artifacts exist and contain valid JSON.
- [ ] Validation confirms every ticket has a retrieval result, routing signals, and a final result.
- [ ] Validation re-derives the deterministic decisions and confirms the final results match.
- [ ] Validation confirms only allowed decisions and risk levels are used.
- [ ] Validation confirms every final result carries retrieved doc IDs and policy references.
- [ ] Validation confirms privacy-sensitive responses disclose no account-specific data.
- [ ] Validation confirms timeline responses promise no unsupported completion times.

### Fallback, tests, docs

- [ ] Weak retrieval automatically downgrades a ticket away from auto-answering.
- [ ] Read a retrieval-confidence value and the recorded reason an answer was not auto-sent in `fallback_analysis.json`.
- [ ] Run tests covering irrelevant retrieved documents, mixed-intent tickets, indirectly phrased privacy requests, and security requests with urgency language.
- [ ] Read `design_notes.md` for the retrieval approach, deterministic vs model-owned responsibilities, safety failure modes, and production improvements.

---

## 6. Required artifacts summary

| Artifact | Status | Notes |
|---|---|---|
| `retrieval_results.json` | MUST | per ticket: ranked `retrieved[]` with `doc_id`, `score`, non-empty `match_reasons` |
| `routing_signals.json` | MUST | five booleans plus `matched_phrases`, `triggered_rules`, `relevant_doc_ids` |
| `triage_results.json` | MUST | fields driven by `required_output_fields`; doc IDs and policy refs non-empty |
| `llm_calls.jsonl` | MUST | one line per LLM call |
| validation command | MUST | single command, no API key needed |
| `fallback_analysis.json` | SHOULD | per downgraded ticket |
| adversarial tests / fixtures | SHOULD | irrelevant docs, mixed intent, indirect privacy, security + urgency |
| output repair logic | SHOULD | malformed model output must not pass through |
| `design_notes.md` | STRETCH | tradeoffs, ownership split, failure modes, production improvements |
| CLI with path flags | STRETCH | `--tickets --kb --policy` style |

---

## 7. Open questions

Carried from the system design, still unresolved.

**Is one combined call wise?** The spec requires it, and it's cheaper and more tonally
consistent. But it couples tickets: one malformed draft would repair the whole batch. *Locked
decision:* repair only the failed tickets — still honest to "one generation call," tighter blast
radius.

**Should risk level be its own axis?** Right now it's pinned to the decision ladder row, carrying
no information the decision doesn't. Alternative: score risk separately from signals, letting a
weak-evidence VIP security ticket read `critical` while an ordinary one reads `high`. *Locked
decision:* pinned to the ladder row for v1.

**How is the weak-evidence threshold chosen?** A fixed cosine floor plus a margin test between
the top two documents. Both constants stated in `design_notes.md`, not buried. Caveat: tuned on
a three-document KB, would need revisiting at scale.

**Non-English tickets?** The schema carries `language`, but rules and synonyms are English-only.
Anything else scores near zero, reads as weak evidence, routes to `needs_human_review` — a safe
default rather than a correct one.
