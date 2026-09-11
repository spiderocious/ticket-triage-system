# Support triage pipeline

An auditable AI support-triage service. It reads tickets, a knowledge base, and a response policy from disk, retrieves
relevant policy snippets deterministically, decides how each ticket should be handled **in code**, then makes one
combined language-model call to draft the customer-facing text.

Deterministic code owns every decision. The model writes prose and nothing else.

---

## Quick start

```bash
npm ci
LLM_PROVIDER=mock npm start     # full run, no API key needed
npm run validate                # independent re-derivation of every decision
npm test                        # unit, adversarial, and end-to-end suites
```

That is the whole evaluation path, and none of it requires a secret. `make install`, `make run-mock`, `make validate`,
and `make test` do the same thing.

To use a real model instead:

```bash
cp .env.example .env            # then add OPENAI_API_KEY=sk-...
npm start
```

Requires Node 20 or newer.

---

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the pipeline and writes all five artifacts |
| `npm run validate` | Re-derives decisions from raw inputs and checks 34 invariants |
| `npm test` | 121 tests across 7 files |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm start -- --help` | Flag reference |

### Flags

```bash
npm start -- --tickets ./fixtures/alt/tickets.json \
             --kb ./fixtures/alt/knowledge_base.json \
             --policy ./fixtures/alt/response_policy.json \
             --out ./out \
             --provider mock \
             --top-k 3
```

Defaults read `tickets.json`, `knowledge_base.json`, and `response_policy.json` from the repository root and write
artifacts there. `npm run validate` accepts `--tickets`, `--kb`, `--policy`, `--out`, and `--top-k` as well, so a run
written elsewhere can be checked in place:

```bash
npm start    -- --out ./out --provider mock
npm run validate -- --out ./out
```

---

## Environment

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `openai` (default) or `mock` |
| `OPENAI_API_KEY` | Needed only by the `openai` provider |
| `OPENAI_MODEL` | Optional override, defaults to `gpt-4o-2024-08-06` |

A `.env` file in the working directory is read at startup. Real environment variables always win over `.env`, so an
explicit `export` is never silently overridden.

**Running without a key.** `LLM_PROVIDER=mock` works unconditionally. If you run the default provider with no key, the
behaviour depends on whether anyone is watching: in an interactive terminal the CLI explains the tradeoff and offers to
switch to the mock provider; when stdout is not a TTY — CI, a scripted evaluation — it never blocks on a keystroke and
exits with setup instructions instead.

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

The decision reaches the model as a fact it must express, never as a question it may answer. The response schema has no
`decision` or `risk_level` field for it to fill — the model is not *trusted* to omit them, it has no slot for them.

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

Row four is the interesting one: a timeline request does not block an answer, it constrains what the answer may say.
The ticket auto-answers while `must_not_promise_unverified_timeframes` is attached to its policy references, passed to
the model as a hard constraint, and checked again after generation.

### Safety gate

Structural validity is not safety — a well-formed string can still quote a balance or promise delivery by Tuesday.
Every draft passes content validators derived from the same signals that produced the decision: no account-specific
disclosure, no unhedged completion promise, no offer to bypass a verification control, and a stated next step on every
refusal or escalation.

On failure the pipeline makes one targeted repair call naming the violation, logged as its own `llm_calls.jsonl` line
with stage `response_repair`. If the rewrite also fails, a deterministic template built from the decision and the
retrieved documents is substituted. Output quality drops; safety does not. The substitution is recorded.

---

## Artifacts

| File | Contents |
|---|---|
| `retrieval_results.json` | Ranked documents per ticket with scores and match reasons |
| `routing_signals.json` | Five routing booleans per ticket, each with supporting evidence |
| `triage_results.json` | Final decision, risk level, citations, and drafted response per ticket |
| `llm_calls.jsonl` | One line per model call, including repairs |
| `fallback_analysis.json` | Tickets downgraded by weak evidence or given a template response |

The model is given no `decision` or `risk_level` field to fill. If a model returns one anyway, the call is rejected
rather than the field quietly stripped, because a returned decision is a bid to own routing that code owns.

`design_notes.md` covers retrieval tradeoffs, the deterministic/model split, safety failure modes, and what would
change for production. `docs/spec.md` is the merged specification.

---

## Validation

`npm run validate` is independent of the pipeline's in-memory objects. It reads the raw inputs and the written artifacts
from disk, re-derives retrieval, signals, and decisions through the same `decide` module the pipeline uses, and compares.
Drift between the two is impossible rather than merely unlikely.

It prints a pass/fail table and exits non-zero on any failure. The 34 checks cover artifact existence and JSON validity,
one record per ticket in each per-ticket artifact, doc-ID referential integrity, ranking order, byte-identical
re-derivation, evidence backing every true signal, decisions and risk levels inside the policy enums, required output
fields, non-empty citations and policy references, the four safety properties, call-log shape, and that weak evidence
never auto-answers.

---

## Swapping the inputs

The three input files can be replaced with any equivalent fixtures using the same schema. Nothing keys on specific
ticket or document identifiers, and the allowed decisions, risk levels, required output fields, and policy rule keys are
all read from `response_policy.json` at runtime.

- `fixtures/alt/` — a complete second input set with different identifier conventions (`TCK-8821`, `DOC-PAY-01`),
  proving no logic keys on the sample IDs.
- `fixtures/adversarial/` — mixed intent (withdrawal question plus balance request), an indirectly phrased privacy
  request, a security request dressed in urgency, a ticket with no relevant document, a non-English ticket, and an
  empty message.

---

## Layout

```
src/
  io/          zod schemas, file read/write, .env
  retrieval/   normalize, synonyms, tfidf, rank
  signals/     phrase rules, evidence scoring
  decide/      the ladder — pure, shared with the validator
  llm/         prompt, providers, schema, call log
  gate/        content validators, templates, fallback
  pipeline.ts  cli.ts  validate.ts
fixtures/      alt + adversarial input sets
tests/         7 files, 121 tests
docs/          spec.md, todo.md, system design
```

---

## Behaviour on the sample data

A smoke test, not a hardcoded expectation — the rules key on phrase patterns and document categories, never on ticket
IDs.

| Ticket | Decision | Why |
|---|---|---|
| Withdrawal delay question | `auto_answer` (medium) | Answerable from the KB, but may not promise a completion time |
| 2FA reset after losing device | `needs_human_review` (high) | Security-sensitive |
| Balance and transaction request | `refuse_and_redirect` (high) | Privacy-sensitive |
