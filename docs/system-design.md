# Triage Pipeline — System Design

An auditable support-triage service in **TypeScript + Node 20+ + the `openai` SDK**. 
Code owns every decision; the model writes prose and nothing else.

---

## The load-bearing constraint

| Owned by code | Owned by the model |
|---|---|
| Which documents are relevant, and their scores | `customer_response` text |
| Whether the ticket asks for account data | `internal_reasoning_summary` text |
| Whether the topic is security-sensitive | |
| Whether a guaranteed timeline was requested | |
| Whether evidence is strong enough | |
| **The final decision and risk level** | |

That is the entire model column. The decision reaches the model as *a fact it must express*, never as a question it may answer.

---

## Does this need a model at all?

Yes, but less than the brief first suggests. Requirement 3 allows exactly one combined call drafting two strings per ticket. Retrieval must be deterministic; the routing decision must be reproducible from code. So the model is a **renderer at the tail of a pipeline that already decided everything**.

Node is the right fit: the deterministic half is string processing — tokenize, TF-IDF, regex rules — and needs no numerical libraries.

**Determinism caveat:** model prose is not byte-reproducible, and the spec doesn't require it. What must be reproducible are the *decisions* — computed before the call, re-derived independently by the validator. We set `temperature: 0` and a fixed `seed` anyway.

---

## Pipeline

| # | Stage | Owner | Writes |
|---|---|---|---|
| 1 | **Load & validate** — zod parse, reject unknown shapes, read enums from policy | code | — |
| 2 | **Normalize & index** — lowercase, strip, stopwords, TF-IDF over `title + content + tags` | code | — |
| 3 | **Retrieve** — score, expand synonyms, sort by score desc / `doc_id` asc | code | `retrieval_results.json` |
| 4 | **Signal & decide** — five booleans with evidence, then the ladder | code | `routing_signals.json` |
| 5 | **Draft** — one call, all tickets, Structured Outputs | **model** | `llm_calls.jsonl` |
| 6 | **Gate & write** — safety validators, repair, fallback | code | `triage_results.json` |

The decision is final at stage 4. Nothing downstream may alter it.

---

## Retrieval: TF-IDF with a synonym bridge

Classic TF-IDF with cosine similarity, ~50 lines, no dependencies. Plain term overlap fails the obvious case: *"my withdrawal is delayed"* shares no term with *"Withdrawal review timeline."*

So query terms expand through a curated synonym map (`delayed → pending, review, processing`) before scoring, and the expansion that fired becomes the `match_reasons` entry — a byproduct of the algorithm, not narration bolted on after.

**Tradeoff:** the map is hand-built, covers the given domain, degrades to plain TF-IDF outside it. Stage 4 catches the failure — below-threshold scores mark weak evidence and never auto-answer. Embeddings would generalize better but would put a network call inside the deterministic half, which is what the brief argues against.

---

## The decision ladder

First match wins, evaluated top to bottom. Ordering is the whole design — safety rules sit above the permissive one, so a mixed-intent ticket resolves to the restrictive branch.

| # | Condition | Decision | Risk |
|---|---|---|---|
| 1 | Asks for account-specific data | `refuse_and_redirect` | high |
| 2 | Security-sensitive topic | `needs_human_review` | high |
| 3 | Evidence weak or missing | `needs_human_review` | medium |
| 4 | Asks for a guaranteed timeline | `auto_answer` | medium |
| 5 | Otherwise | `auto_answer` | low |

Row 4 is the interesting one: a timeline request doesn't *block* an answer, it constrains what the answer may say. The ticket auto-answers, but `must_not_promise_unverified_timeframes` is attached to `policy_references`, passed to the model as a hard instruction, and checked again at stage 6.

**Trap:** the three sample tickets map one-to-one onto the three decisions. Rules that fit those three can fail the evaluator's fixtures. Every rule keys on phrase patterns and document categories, never a ticket ID — and tests run against a second fixture set with different IDs.

---

## Constraining the call

The response schema is the primary guardrail. The model isn't *trusted* to omit a decision field — it has no such field to fill.

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

After parsing, ticket IDs reconcile against the input set. A missing ticket, duplicate, or unknown ID is a hard failure — not a silent gap.

---

## The safety gate

Structural validity isn't safety. A well-formed string can still quote a balance or promise delivery by Tuesday. Each draft runs through content validators derived from the same signals that produced the decision:

- Privacy-flagged ticket → no currency figures, no transaction language
- Timeline-flagged ticket → no exact-duration promise (`/\b(within|in|by)\s+\d+\s*(hour|day|minute)/i` and relatives)
- No response may offer to disable, bypass, or skip verification
- Every refusal or escalation must state a next step

**On failure:** one repair call naming the specific violation, logged as its own `llm_calls.jsonl` record with stage `response_repair`. If the rewrite also fails, substitute a deterministic template built from the decision and retrieved documents. Output quality drops; safety doesn't. The run still succeeds, and the substitution is recorded.

---

## Repository

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

`decide/` is imported by both the pipeline and the validator. The validator re-runs it from raw inputs and compares against what was written — so drift is caught, not rubber-stamped.

---

## Running it

```bash
npm start                          # defaults to ./tickets.json etc.
npm start -- --tickets ./fixtures/alt/tickets.json \
             --kb ./fixtures/alt/knowledge_base.json \
             --policy ./response_policy.json
npm run validate                   # independent re-derivation
npm test                           # adversarial + edge-case suite
```

`OPENAI_API_KEY` drives the real provider. Without it the pipeline does not simply fail: `LLM_PROVIDER=mock` selects a deterministic template renderer that passes through the same schema, safety gate and call log, so the whole pipeline is exercised with no secret. An interactive run with no key offers that switch; a non-interactive one exits naming the variable rather than blocking on a keystroke. `validate` and `test` never need a key — they operate on artifacts and pure functions, so the deterministic half is verifiable without spending a token.

---

## Decisions worth revisiting

**Is one combined call wise?** The spec requires it, and it's cheaper and more tonally consistent. But it couples tickets: one malformed draft currently repairs the whole batch. Consider resending only failed tickets — still honest to "one generation call," tighter blast radius.

**Should risk level be its own axis?** Right now it's pinned to the decision row, carrying no information the decision doesn't. Alternative: score risk separately from signals, letting a weak-evidence VIP security ticket read `critical` while an ordinary one reads `high`.

**How is the weak-evidence threshold chosen?** A fixed cosine floor plus a margin test between the top two documents. Both constants stated in `design_notes.md`, not buried. Caveat: tuned on a three-document KB, would need revisiting at scale.

**Non-English tickets?** The schema carries `language`, but rules and synonyms are English-only. Anything else scores near zero, reads as weak evidence, routes to `needs_human_review` — a safe default rather than a correct one.
