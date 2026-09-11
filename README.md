# Support triage pipeline

An auditable AI support-triage service. It reads support tickets, a knowledge base, and a response policy from disk,
retrieves relevant policy snippets deterministically, decides how each ticket should be handled **in code**, then makes
one combined language-model call to draft the customer-facing text.

**Deterministic code owns every decision. The model writes prose and nothing else.**

Every artifact is reproducible from the same inputs, every model-assisted decision carries evidence, and the whole
pipeline runs without an API key.

---

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Commands](#commands)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Artifacts](#artifacts)
- [Validation](#validation)
- [Testing](#testing)
- [Swapping the inputs](#swapping-the-inputs)
- [Tuning constants](#tuning-constants)
- [Error identities](#error-identities)
- [Repository layout](#repository-layout)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

---

## Quick start

```bash
npm ci
LLM_PROVIDER=mock npm start     # full run, no API key needed
npm run validate                # independent re-derivation of every decision
npm test                        # 127 tests across 7 files
```

That is the entire evaluation path and none of it requires a secret. Expect three tickets resolving to one decision
each, then `37/37 checks passed`.

To use a real model instead:

```bash
cp .env.example .env            # then add OPENAI_API_KEY=sk-...
npm start
```

`make install`, `make run-mock`, `make validate`, and `make test` are equivalent to the npm commands.

---

## Requirements

- **Node.js 20 or newer.** Enforced by `engines` in `package.json`.
- **Python 3** only if you want the `python validate.py` entry point. Everything else is Node.
- **No API key required.** A key unlocks real model drafting; the pipeline, validation, and tests all run without one.

No database, no network service, and no external state. Everything reads from and writes to plain files.

---

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the pipeline and writes all five artifacts |
| `npm run validate` | Re-derives decisions from raw inputs and runs 37 checks |
| `python3 validate.py` | Same 37 checks, via the entry point the brief names |
| `make validate` | Same 37 checks |
| `npm test` | 127 tests across 7 files |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm start -- --help` | Flag reference |

All three validation entry points run identical checks and return the same exit code. Use whichever fits your harness.

### Flags

```bash
npm start -- --tickets ./fixtures/alt/tickets.json \
             --kb ./fixtures/alt/knowledge_base.json \
             --policy ./fixtures/alt/response_policy.json \
             --out ./out \
             --provider mock \
             --top-k 3
```

| Flag | Default | Meaning |
|---|---|---|
| `--tickets` | `tickets.json` | Path to the tickets file |
| `--kb` | `knowledge_base.json` | Path to the knowledge base |
| `--policy` | `response_policy.json` | Path to the response policy |
| `--out` | `.` | Directory artifacts are written to |
| `--provider` | `openai` | `openai` or `mock` |
| `--top-k` | `3` | Maximum documents retrieved per ticket |

`npm run validate` accepts `--tickets`, `--kb`, `--policy`, `--out`, and `--top-k` too, so a run written elsewhere can
be checked in place:

```bash
npm start        -- --out ./out --provider mock
npm run validate -- --out ./out
```

Note the `--` separator. It tells npm to forward the flags to the script rather than consuming them itself.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` or `mock` |
| `OPENAI_API_KEY` | none | Needed only by the `openai` provider |
| `OPENAI_MODEL` | `gpt-4o-2024-08-06` | Model override |

A `.env` file in the working directory is read at startup. Real environment variables always win over `.env`, so an
explicit `export` is never silently overridden. Empty values in `.env` are skipped, so a placeholder line cannot mask a
real key.

### Running without a key

`LLM_PROVIDER=mock` works unconditionally. If you run the default provider with no key, behaviour depends on whether
anyone is watching:

- **Interactive terminal.** The CLI explains the tradeoff and offers to switch to the mock provider. Answering yes
  proceeds; answering no exits with setup instructions.
- **Not a terminal.** In CI or a scripted evaluation it never blocks on a keystroke. It exits immediately with status 1
  and prints the setup instructions.

The `mock` provider is a deterministic template renderer. It goes through the same response schema, the same safety
gate, the same reconciliation, and the same call log as the real provider, so the whole pipeline and every validation
check are genuinely exercised. Only the customer-facing wording is templated rather than generated.

---

## How it works

Six stages. **The decision is final at stage four and nothing downstream may alter it.**

| # | Stage | Owner | Writes |
|---|---|---|---|
| 1 | Load and validate inputs (zod, strict) | code | |
| 2 | Normalize and index the knowledge base (TF-IDF) | code | |
| 3 | Retrieve and rank | code | `retrieval_results.json` |
| 4 | Derive signals, then apply the decision ladder | code | `routing_signals.json` |
| 5 | Draft responses in one combined call | **model** | `llm_calls.jsonl` |
| 6 | Safety gate, repair, fallback, assemble | code | `triage_results.json` |

### What the model does and does not own

| Owned by code | Owned by the model |
|---|---|
| Which documents are relevant, and their scores | `customer_response` text |
| Whether the ticket asks for account-specific data | `internal_reasoning_summary` text |
| Whether the topic is security-sensitive | |
| Whether a guaranteed timeline was requested | |
| Whether the evidence is strong enough | |
| **The final decision and risk level** | |

That is the entire model column. The decision reaches the model as a fact it must express, never as a question it may
answer. The response schema has no `decision` or `risk_level` field for it to fill, so the model is not *trusted* to
omit them, it has no slot for them.

If a model returns a routing field anyway, the call is **rejected**, not quietly stripped. That holds even when the
returned value agrees with the computed decision, because a returned decision is a bid to own routing that code owns,
and silently discarding it would hide the attempt. The failure surfaces as `llm_owned_decision`.

### Retrieval

TF-IDF with cosine similarity over `title + content + tags`, about a hundred lines with no runtime dependencies.
Documents are indexed in `doc_id` order and results sort by score descending then `doc_id` ascending, so ranking never
depends on file or object iteration order. Scores round to four decimal places, which makes reruns byte-identical
rather than merely equivalent.

Plain term overlap fails the obvious case: a ticket saying "my withdrawal has been pending" shares almost no vocabulary
with a document titled "Withdrawal review timeline". Query terms therefore expand through a curated synonym map before
scoring, and **the expansion that fired becomes the match reason**. The explanation is a by-product of the algorithm
rather than narration added afterwards, so a reason can never claim a contribution that did not happen.

### The decision ladder

First match wins, top to bottom. The safety rows sit above the permissive one, so a mixed-intent ticket resolves to the
restrictive branch.

| # | Condition | Decision | Risk |
|---|---|---|---|
| 1 | Asks for account-specific data | `refuse_and_redirect` | high |
| 2 | Security-sensitive topic | `needs_human_review` | high |
| 3 | Evidence weak or missing | `needs_human_review` | medium |
| 4 | Asks for a guaranteed timeline | `auto_answer` | medium |
| 5 | Otherwise | `auto_answer` | low |

Row four is the interesting one. A timeline request does not *block* an answer, it constrains what the answer may say.
The ticket auto-answers while `must_not_promise_unverified_timeframes` is attached to its policy references, passed to
the model as a hard constraint, and checked again after generation.

The ladder lives in `src/decide/` and is imported by **both** the pipeline and the validator, so drift between what was
written and what the validator expects is impossible rather than merely unlikely.

### Safety gate

Structural validity is not safety. A well-formed string can still quote a balance or promise delivery by Tuesday. Every
draft passes content validators derived from the same signals that produced the decision:

| Check | Applies to | Rejects |
|---|---|---|
| Privacy | every response | Currency figures, balance or transaction disclosure, long digit runs |
| Timeline | timeline-flagged and auto-answered tickets | Unhedged completion promises, guarantees, named-day promises |
| Security bypass | every response | Offers to disable, skip, or bypass verification |
| Next step | refusals and escalations | Text with no stated next step |
| Grounding | auto-answered tickets | Responses that do not draw on the cited document |

Hedged ranges survive deliberately. The knowledge base itself says review windows are "typically up to 24 hours, but
exceptions exist", so a blanket ban on durations would reject the correct answer. A numeric duration is flagged only
when its sentence is promissory and carries no hedge.

**On failure** the pipeline makes one targeted repair call naming the specific violation, logged as its own
`llm_calls.jsonl` line with stage `response_repair`. Only the tickets that failed are resent, not the whole batch. If
the rewrite also fails, a deterministic template built from the decision and the retrieved documents is substituted, and
that substitution is recorded in `fallback_analysis.json`. Output quality drops; safety does not. The template is held
to the same gate as the model's own text, so a template that could violate a rule fails the run rather than shipping.

---

## Artifacts

Written to the repository root by default, or to `--out <dir>`.

| File | Contents |
|---|---|
| `retrieval_results.json` | Ranked documents per ticket with scores and match reasons |
| `routing_signals.json` | Five routing booleans per ticket, each with supporting evidence |
| `triage_results.json` | Final decision, risk level, citations, and drafted response per ticket |
| `llm_calls.jsonl` | One line per model call, including repairs |
| `fallback_analysis.json` | Tickets downgraded by weak evidence or given a template response |

### `retrieval_results.json`

One record per ticket, ranked highest score first, ties broken on `doc_id` ascending.

```json
{
  "ticket_id": "t001",
  "retrieved": [
    {
      "doc_id": "kb_001",
      "score": 0.6309,
      "match_reasons": ["keyword: withdraw", "synonym: delay→review", "tag: withdraw", "category: payments"]
    }
  ]
}
```

`match_reasons` is never empty. Six reason prefixes exist:

| Prefix | Fires when |
|---|---|
| `keyword:` | A ticket term appears directly in the document |
| `synonym:` | A synonym expansion matched, shown as `from→to` |
| `tag:` | A ticket term matched one of the document's tags |
| `category:` | The ticket text or an expansion matched the document's category |
| `overlap:` | The document scored above zero but produced no other reason |
| `fallback:` | The ticket had no lexical overlap with any document, so the first document is cited at score 0 |

The last two are safety nets. `fallback:` keeps `retrieved_doc_ids` non-empty as the schema requires, while the zero
score still reads as weak evidence and routes the ticket to human review rather than an answer.

### `routing_signals.json`

One record per ticket. Every true boolean is traceable to at least one entry in `matched_phrases`, `triggered_rules`,
or `relevant_doc_ids`.

```json
{
  "ticket_id": "t001",
  "asks_for_account_specific_data": false,
  "is_security_sensitive": false,
  "asks_for_guaranteed_timeline": true,
  "evidence_is_weak_or_missing": false,
  "safe_for_auto_answer": true,
  "matched_phrases": ["pending for 18 hours", "when it will complete"],
  "triggered_rules": ["must_not_promise_unverified_timeframes"],
  "relevant_doc_ids": ["kb_001"],
  "retrieval_confidence": 0.6309
}
```

`matched_phrases` are literal spans as they appear in the ticket text. `triggered_rules` are policy rule keys, and only
keys actually present and true in the loaded policy appear.

### `triage_results.json`

One record per ticket. The field list is driven by `required_output_fields` in the policy; the run fails with
`required_field_unsupported` if the policy demands a field the pipeline cannot supply.

```json
{
  "ticket_id": "t001",
  "decision": "auto_answer",
  "risk_level": "medium",
  "retrieved_doc_ids": ["kb_001", "kb_002"],
  "policy_references": ["must_not_promise_unverified_timeframes"],
  "customer_response": "...",
  "internal_reasoning_summary": "..."
}
```

`retrieved_doc_ids` and `policy_references` are always non-empty.

### `llm_calls.jsonl`

One JSON object per line, one line per call. A repair retry is a second call and gets its own line.

```json
{
  "stage": "response_generation",
  "ticket_id": null,
  "timestamp": "2026-09-11T07:55:22.183Z",
  "provider": "mock",
  "model": "deterministic-template-v1",
  "prompt_hash": "166e0d02...",
  "input_artifacts": ["tickets.json", "knowledge_base.json", "response_policy.json", "retrieval_results.json", "routing_signals.json"],
  "output_artifact": "triage_results.json",
  "ticket_ids": ["t001", "t002", "t003"],
  "outcome": "ok"
}
```

`ticket_id` is `null` for the combined all-ticket call. `prompt_hash` is a SHA-256 of the exact prompt sent, stable
across runs on the same inputs. `ticket_ids` and `outcome` are extra audit fields beyond the required set.

### `fallback_analysis.json`

One record per ticket that was downgraded or had its text substituted. Empty on the sample data, populated on the
adversarial fixture.

```json
{
  "ticket_id": "adv-irrelevant-kb",
  "retrieval_confidence": 0.0705,
  "original_decision": "auto_answer",
  "final_decision": "needs_human_review",
  "reason_not_auto_sent": "retrieval evidence was weak or missing (confidence 0.0705), so the ticket was downgraded from auto_answer to needs_human_review"
}
```

---

## Validation

Validation is independent of the pipeline's in-memory objects. It reads the raw inputs and the written artifacts from
disk, re-derives retrieval, signals, and decisions through the same `decide` module the pipeline uses, and compares.

It prints a pass/fail table and exits non-zero on any failure. It needs no API key, because it operates on artifacts and
pure functions.

```bash
npm run validate          # or: python3 validate.py, or: make validate
```

The 37 checks cover:

**Inputs and artifacts**
- Inputs load and match the schema
- All five artifacts exist and parse as valid JSON
- Every ticket appears exactly once in each per-ticket artifact

**Retrieval integrity**
- Every retrieved `doc_id` exists in the knowledge base
- Every retrieved document carries at least one match reason
- Ranking is score descending then `doc_id` ascending
- Retrieval re-derives byte-identically from the inputs

**Decisions**
- Routing signals re-derive from the inputs
- Every true routing signal is backed by evidence
- Final decisions and risk levels match the deterministic re-derivation
- Every decision and risk level is reproducible from code without the model
- Only allowed decisions and risk levels are used

**Output completeness**
- Every record carries the policy's required output fields
- Citations and policy references are non-empty
- Policy references are keys from the policy rules
- `retrieved_doc_ids` matches `retrieval_results.json` for that ticket

**Safety**
- No response discloses account-specific data
- No timeline response promises an unsupported completion time
- No response offers to bypass a security procedure
- Every refusal or escalation states a next step
- Auto-answered responses are grounded in their cited documents
- Finalised drafts satisfy the LLM output schema

**Call log and fallback**
- At least one `response_generation` call is recorded, with every required field
- Call ticket references are `null` or a known ticket
- `fallback_analysis.json` references only known tickets
- Weak evidence never auto-answers

---

## Testing

```bash
npm test                            # everything
npx vitest run tests/gate.test.ts   # one file
npx vitest                          # watch mode
```

| File | Covers |
|---|---|
| `tests/retrieval.test.ts` | Normalization, synonym expansion, ranking, tie-breaks, byte-identical reruns |
| `tests/signals.test.ts` | Phrase detectors, evidence assessment, the five booleans and their evidence |
| `tests/decide.test.ts` | Every ladder row, mixed intent, policy enum rejection |
| `tests/gate.test.ts` | Each safety validator positive and negative, template substitution |
| `tests/llm.test.ts` | Prompt determinism, schema validation, reconciliation, routing-field rejection |
| `tests/cli.test.ts` | Missing-key prompt in both modes, `.env` loading semantics |
| `tests/pipeline.e2e.test.ts` | All three fixture sets end to end, then validated |

The end-to-end suite runs the full pipeline on the sample, alternate, and adversarial fixtures, then runs the validator
against each result and asserts every check passes.

### Things worth verifying by hand

```bash
# reruns are byte-identical
LLM_PROVIDER=mock npm start -- --out /tmp/run1
LLM_PROVIDER=mock npm start -- --out /tmp/run2
diff /tmp/run1/triage_results.json /tmp/run2/triage_results.json && echo IDENTICAL

# bad input fails loudly
LLM_PROVIDER=mock npm start -- --tickets does-not-exist.json

# no key, non-interactive: exits 1, never hangs
unset OPENAI_API_KEY && npm start < /dev/null; echo "exit=$?"
```

---

## Swapping the inputs

The three input files can be replaced with any equivalent fixtures using the same schema. Nothing keys on specific
ticket or document identifiers, and the allowed decisions, risk levels, required output fields, and policy rule keys are
all read from `response_policy.json` at runtime.

Two complete alternative input sets ship with the repository:

- **`fixtures/alt/`** — different identifier conventions (`TCK-8821`, `DOC-PAY-01`) and reordered tickets, proving no
  logic keys on the sample IDs.
- **`fixtures/adversarial/`** — mixed intent (a withdrawal question combined with a balance request), an indirectly
  phrased privacy request, a security request dressed in urgency, a ticket with no relevant document, a non-English
  ticket, and an empty message.

```bash
LLM_PROVIDER=mock npm start -- \
  --tickets fixtures/adversarial/tickets.json \
  --kb fixtures/adversarial/knowledge_base.json \
  --policy fixtures/adversarial/response_policy.json \
  --out /tmp/adv

npm run validate -- \
  --tickets fixtures/adversarial/tickets.json \
  --kb fixtures/adversarial/knowledge_base.json \
  --policy fixtures/adversarial/response_policy.json \
  --out /tmp/adv
```

All three fixture sets pass 37 of 37 checks.

### Input schemas

`tickets.json` is an array of objects with `ticket_id`, `created_at`, `channel`, `language`, `customer_tier`,
`subject`, and `message`. `knowledge_base.json` is an array with `doc_id`, `title`, `category`, `content`, and `tags`.
`response_policy.json` is a single object with `allowed_decisions`, `allowed_risk_levels`, `required_output_fields`,
and a `rules` map of boolean flags. Schemas are strict: unknown keys, duplicate identifiers, and empty arrays are
rejected at load time.

---

## Tuning constants

Every threshold is named and exported from `src/core/constants.ts`, so the pipeline, the validator, and the design notes
all cite the same values rather than duplicating magic numbers.

| Constant | Value | Meaning |
|---|---|---|
| `SCORE_PRECISION` | 4 | Decimal places scores round to |
| `TOP_K_DEFAULT` | 3 | Documents retrieved per ticket |
| `WEAK_EVIDENCE_FLOOR` | 0.10 | Top score below this means weak evidence |
| `WEAK_EVIDENCE_MARGIN` | 0.05 | Top two within this is ambiguous |
| `STRONG_EVIDENCE_BAR` | 0.35 | Above this, a narrow margin is tolerated |
| `OPENAI_SEED` | 7 | Fixed seed on the model call |

These are tuned on a three-document knowledge base and would need revisiting at scale. `design_notes.md` explains the
reasoning.

---

## Error identities

Failures carry a stable snake_case identity, a human-readable message from a central registry, and an optional
operator-facing detail. **Branch on the identity, never the message or the detail.**

| Identity | Meaning |
|---|---|
| `input_missing` | An input file could not be found |
| `input_malformed` | An input file is not valid JSON |
| `schema_violation` | An input file does not match the schema |
| `duplicate_id` | Duplicate `ticket_id` or `doc_id` |
| `decision_not_allowed` | Computed decision is outside `allowed_decisions` |
| `risk_not_allowed` | Computed risk is outside `allowed_risk_levels` |
| `signal_untraceable` | A routing signal was set with no supporting evidence |
| `llm_key_missing` | `OPENAI_API_KEY` is not set |
| `llm_provider_unknown` | Provider is neither `openai` nor `mock` |
| `llm_call_failed` | The provider call failed |
| `llm_output_invalid` | Model output failed schema validation |
| `llm_owned_decision` | Model returned a decision or risk level, which only code may set |
| `ticket_reconciliation_failed` | Drafts do not reconcile one-to-one with tickets |
| `safety_violation` | A draft violated a safety constraint after all recovery paths |
| `required_field_unsupported` | The policy requires a field the pipeline cannot supply |
| `write_failed` | Writing an artifact failed |

No function in `src/` throws a domain error. Everything returns a `Result<T, AppError>`, and `unwrap` exists only at the
CLI and test boundary.

---

## Repository layout

```
src/
  core/        Result type, error identities, message registry, shared types, constants
  io/          zod schemas, loaders, deterministic writers, .env reader
  retrieval/   normalize, synonyms, tfidf, rank
  signals/     phrase rules, evidence scoring, signal assembly
  decide/      the ladder — pure, shared with the validator
  llm/         prompt, providers, schema, draft validation, call log
  gate/        content validators, templates, fallback analysis
  pipeline.ts  orchestration, stages 1-6
  cli.ts       flags, missing-key prompt
  validate.ts  independent re-derivation, 37 checks
fixtures/      alt + adversarial input sets
tests/         7 files, 127 tests
docs/          spec.md, system-design.md, todo.md
validate.py    thin shim to src/validate.ts
```

---

## Troubleshooting

**`npm start` exits asking for a key.** Either set `OPENAI_API_KEY` in `.env`, or run `LLM_PROVIDER=mock npm start`.
The mock path exercises everything except real model wording.

**Flags seem to be ignored.** npm needs `--` before script flags: `npm start -- --out ./out`, not
`npm start --out ./out`.

**Validation fails after editing inputs.** The validator re-derives decisions from the current inputs and compares them
against the artifacts on disk. If you change the inputs, rerun the pipeline before validating.

**A ticket retrieved a document that looks irrelevant.** Check `retrieval_confidence` in `routing_signals.json`. A low
value means the weak-evidence rule fired and the ticket was routed to human review rather than answered. That is the
intended behaviour and `fallback_analysis.json` records it.

**`python validate.py` says Node is required.** The shim delegates to the TypeScript validator. Install Node 20 or
newer and run `npm ci` first.

---

## Further reading

| Document | Contents |
|---|---|
| `design_notes.md` | Retrieval tradeoffs, deterministic/model split, safety failure modes, production improvements |
| `docs/system-design.md` | The architecture this implementation follows |
| `docs/spec.md` | The merged specification |
| `docs/todo.md` | Build log, audit against the spec, rehearsal results |
| `CLAUDE.md` | Conventions for anyone extending the code |

---

## Behaviour on the sample data

A smoke test, not a hardcoded expectation. The rules key on phrase patterns and document categories, never on ticket
identifiers.

| Ticket | Decision | Risk | Why |
|---|---|---|---|
| Withdrawal delay question | `auto_answer` | medium | Answerable from the knowledge base, but may not promise a completion time |
| 2FA reset after losing device | `needs_human_review` | high | Security-sensitive, routed to identity verification |
| Balance and transaction request | `refuse_and_redirect` | high | Privacy-sensitive, redirected to authenticated surfaces |
