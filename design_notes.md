# Design notes

An auditable support-triage pipeline in TypeScript and Node. Deterministic code owns every routing decision; the
language model writes prose and nothing else.

## Retrieval approach and tradeoffs

Retrieval is TF-IDF with cosine similarity over `title + content + tags`, implemented in about a hundred lines with no
runtime dependencies. Documents are indexed in `doc_id` order and results are sorted by score descending then `doc_id`
ascending, so ranking never depends on input file order or object iteration order. Scores are rounded to four decimal
places, which makes reruns byte-identical rather than merely equivalent.

Plain term overlap fails the obvious case. A ticket saying "my withdrawal has been pending" shares almost no vocabulary
with a document titled "Withdrawal review timeline". Query terms therefore expand through a curated synonym map before
scoring, and the expansion that fired becomes the `match_reasons` entry. The explanation is a by-product of the
algorithm rather than narration added afterwards, so a reason can never claim a contribution that did not happen.

The tradeoff is coverage. The map is hand-built for this domain and degrades to plain TF-IDF outside it. That
degradation is caught rather than hidden: a below-threshold top score marks the evidence weak, and weak evidence never
auto-answers. Embeddings would generalise better but would put a network call inside the deterministic half of the
pipeline, which is exactly what the brief argues against. A defensible middle path for production is embeddings for
recall with a deterministic lexical re-rank deciding the final order.

Non-English tickets are a known gap. The schema carries a `language` field, but the rules and the synonym map are
English-only, so anything else scores near zero, reads as weak evidence, and routes to human review. That is a safe
default rather than a correct one.

## Deterministic versus model-owned responsibilities

| Owned by code | Owned by the model |
|---|---|
| Which documents are relevant, and their scores | `customer_response` text |
| Whether the ticket asks for account-specific data | `internal_reasoning_summary` text |
| Whether the topic is security-sensitive | |
| Whether a guaranteed timeline was requested | |
| Whether the evidence is strong enough | |
| The final decision and risk level | |

That is the entire model column. The decision reaches the model as a fact it must express, never as a question it may
answer, and the response schema has no `decision` or `risk_level` field for it to fill. The model is not trusted to omit
those fields; it has no slot for them.

The decision ladder is five ordered rows, first match wins. Ordering is the whole design: the safety rows sit above the
permissive one, so a ticket that asks about a withdrawal delay *and* requests a balance resolves to the restrictive
branch. Row four is the interesting one. A timeline request does not block an answer, it constrains what the answer may
say, so the ticket auto-answers while the no-unverified-timeframes rule is attached to its policy references, passed to
the model as a hard constraint, and checked again after generation.

The same `decide` module is imported by the pipeline and by the validator. The validator re-derives signals and
decisions from the raw inputs and compares them against what was written, so drift between the two is impossible rather
than merely unlikely.

## Key safety failure modes

**Structural validity is not safety.** A well-formed string can still quote a balance or promise delivery by Tuesday.
Every draft passes content validators derived from the same signals that produced the decision: no currency figures or
account-specific disclosure in any customer reply, no unhedged completion promise on a timeline or auto-answered
ticket, no offer to disable or bypass a verification control, and a stated next step on every refusal or escalation.

**Hedged ranges versus promises.** The knowledge base itself says review windows are "typically up to 24 hours, but
exceptions exist". A blanket ban on durations would reject the correct answer. The validator instead flags a numeric
duration only when its sentence is promissory and carries no hedge, which keeps the legitimate phrasing and rejects
"your withdrawal will complete within 2 hours".

**A confident answer from thin evidence.** Weak retrieval is the failure mode most likely to produce a fluent and wrong
reply. The evidence test is a cosine floor of 0.10 plus a margin test: if the top two documents are within 0.05 of each
other and the top score is below 0.35, the retrieval is treated as ambiguous. Either condition downgrades the ticket to
human review and writes a record to `fallback_analysis.json` explaining why it was not auto-sent.

That file also records a third, non-downgrading case: a ticket whose top score clears the floor but sits below the
strong-evidence bar is written with trigger `near_threshold` and action `recorded_only`. It changes no decision. It
exists because a silent artifact is indistinguishable from an unexercised code path, and a reviewer should be able to
see which matches were merely adequate rather than convincing. Every record carries `top_score`, `second_score` and
`margin`, so the thresholds can be audited against the raw numbers rather than taken on trust.

Those constants are tuned on a three-document knowledge base and would need revisiting at scale. The floor is the
number most exposed to a larger corpus: TF-IDF scores compress as the document count grows, so a fixed 0.10 could
eventually mark good matches weak. A percentile-based floor computed per corpus is the production answer.

**An answer that cites a document it did not use.** Grounding is checked by counting distinct content terms shared
between the reply and its top cited document. The threshold is four. Two, the obvious first choice, certifies grounding
that has not happened: in this domain almost any plausible reply contains "withdrawal" and "review", so fabricated text
cleared the bar. Four requires the reply to track the document, and still passes legitimate short replies, which run
forty words or more and typically share six to ten terms with the document they paraphrase. The check is skipped when
the cited document was the no-overlap fallback at score zero, since there is nothing to be grounded in and the
weak-evidence rule has already routed the ticket away from an automatic answer.

**Malformed or unusable model output.** Drafts are parsed against a schema and reconciled one-to-one with the input
ticket set; a missing, duplicated, or unknown ticket id is a hard failure rather than a silent gap. A ticket that fails
the gate gets one targeted repair call naming the specific violation, logged as its own `llm_calls.jsonl` record. If the
rewrite also fails, a deterministic template built from the decision and the retrieved documents is substituted, and
that substitution is recorded. Output quality drops; safety does not. The template is held to the same gate as the
model's own text, so a template that could violate a rule fails the run rather than shipping.

**Total generation failure.** If the provider call fails outright, every ticket falls back to a template and the run
still completes with valid artifacts. The call log records the failed call with its outcome, so the degradation is
visible rather than inferred.

## What to improve for production scale, observability, and monitoring

The single combined call is cheaper and more tonally consistent, and the brief requires it, but it couples tickets. The
repair path already resends only the tickets that failed rather than the whole batch, which keeps the blast radius
tight; at real volume the generation call itself should be chunked with bounded concurrency and per-chunk retry.

Risk level is currently pinned to the decision row, so it carries no information the decision does not. Scoring risk
separately from the signals would let a weak-evidence security ticket from a high-value customer read critical while an
ordinary one reads high, which is the difference between a queue and a priority queue.

For observability, the artifacts are already an audit trail, but they are per-run files. Production wants the call log
shipped as structured events with latency, token counts, and cost per stage; counters for decision mix, gate violation
rate by validator, repair rate, and template substitution rate; and an alert on any of those moving sharply, since a
rising substitution rate means the model drifted or the prompt broke. Retrieval confidence should be histogrammed, as a
leftward drift signals the knowledge base falling behind the ticket mix.

The gap that matters most is an evaluation harness. The safety validators are regex-based, which makes them fast,
explainable, and evadable by phrasing nobody anticipated. A labelled set of adversarial tickets, replayed on every
prompt or model change with the gate's decisions scored against human judgement, is what turns the validators from a
static net into something that improves. Pairing that with a second-opinion classifier on the final text, in shadow
mode at first, would catch what the patterns miss without putting a model in the decision path.
