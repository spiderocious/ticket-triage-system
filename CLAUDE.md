# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A small, replayable AI support-triage service. It reads three JSON files from disk
(`tickets.json`, `knowledge_base.json`, `response_policy.json`), retrieves relevant
knowledge base docs deterministically, computes rule-based routing signals, assigns a
decision in code, then makes **one combined LLM call** to draft customer-facing responses
and internal summaries for all tickets. Every artifact must be reproducible and auditable.

An evaluator will run this from a clean checkout and may replace the input files with
fixtures that use the same schema. Nothing may depend on specific ticket IDs, doc IDs,
fixed output text, or manual review steps.

Source of truth for requirements, in priority order:

1. `docs/system-design.md` — system design (pending; user will supply a diagram)
2. `docs/features.md` — problem statement, MUST / SHOULD / STRETCH scope, validation checks
3. `docs/artifacts-schema.md` — exact field schemas and cross-artifact invariants
4. `docs/mvp-list.md` — user stories, useful as an acceptance checklist
5. `docs/stack.md` — stack choice

Note: `artifacts-schema.md` references a `validation-checklist.md` that does not exist.
Use section 5 of `features.md` as the validation checklist.

## Stack

- TypeScript on Node.js (Node 25 available locally; target a version an evaluator will have, LTS-compatible code)
- OpenAI SDK for the single LLM call
- Sample inputs live in `raw/`. Do not edit them in place; treat them as fixtures.

## Non-negotiable guardrails

These are spec requirements. Do not trade them away for convenience.

- **Deterministic code owns retrieval and routing.** Keyword / TF-IDF style scoring with
  explicit, reproducible ranking. Sort by score desc, tie-break on `doc_id` asc. Round
  scores to fixed precision so reruns are byte-identical.
- **The LLM never owns the decision.** `decision` is computed in code from routing signals
  plus the policy. LLM output is validated against the allowed decisions, allowed risk
  levels, and the already-computed decision. Mismatches are rejected or repaired, never
  silently passed through.
- **Exactly one combined LLM call** for all tickets in the main path. A repair retry is a
  second call and gets its own line in `llm_calls.jsonl`.
- **Read enums from the policy file at runtime.** `allowed_decisions`,
  `allowed_risk_levels`, `required_output_fields`, and `rules` keys must not be hardcoded.
- **No secrets required to run.** Provide a provider abstraction with an offline / mock
  path so the pipeline and validation run with no API key. Real OpenAI use is opt-in via
  env var.
- **Byte-identical deterministic artifacts** on rerun with unchanged inputs
  (`retrieval_results.json`, `routing_signals.json`, decision fields). Stable key ordering,
  no timestamps inside deterministic artifacts.
- **Safe response constraints.** Customer responses must not disclose balances,
  transactions, or personal data; must not promise exact completion times unless policy and
  evidence allow it; must not disable or bypass security procedures; must ground answers in
  retrieved KB docs; must give a clear polite next step on refusal or escalation.
- **Fail loudly on bad input.** Missing, malformed, or schema-violating input files must
  produce a clear error, not a partial run.
- **Never invent account-specific customer data**, in code, fixtures, prompts, or tests.

## Required artifacts

Written relative to the repo root unless the system design says otherwise.

| Artifact | Status | Notes |
|---|---|---|
| `retrieval_results.json` | MUST | per ticket: ranked `retrieved[]` with `doc_id`, `score`, non-empty `match_reasons` |
| `routing_signals.json` | MUST | per ticket: five booleans plus `matched_phrases`, `triggered_rules`, `relevant_doc_ids`; every boolean traceable to evidence |
| `triage_results.json` | MUST | fields driven by `required_output_fields`; `retrieved_doc_ids` and `policy_references` non-empty |
| `llm_calls.jsonl` | MUST | one line per LLM call: `stage`, `ticket_id` (null for combined call), `timestamp`, `provider`, `model`, `prompt_hash`, `input_artifacts`, `output_artifact` |
| validation command | MUST | `python validate.py` or equivalent single command (e.g. `make validate`, `npm run validate`) |
| `fallback_analysis.json` | SHOULD | per downgraded ticket: `retrieval_confidence`, `original_decision`, `final_decision`, `reason_not_auto_sent` |
| adversarial tests / fixtures | SHOULD | irrelevant docs, mixed intent, indirect privacy request, security + urgency |
| output repair logic | SHOULD | malformed model output must not pass through |
| `design_notes.md` | STRETCH | retrieval tradeoffs, deterministic vs model-owned, safety failure modes, production improvements |
| CLI with path flags | STRETCH | `--tickets --kb --policy` style |

Cross-artifact invariants (validation must check these):

- every ticket appears exactly once in each of the three per-ticket artifacts
- every referenced `doc_id` exists in the knowledge base
- `retrieved_doc_ids` in triage matches the retrieval list for that ticket
- `decision` in triage equals the decision re-derived from routing signals plus policy
- only allowed decisions and risk levels are used
- privacy-sensitive responses disclose no account-specific data
- timeline responses promise no unsupported exact completion times
- LLM output structure is validated before finalization

## Routing signals to compute per ticket

Before any LLM call, derive at least:

- `asks_for_account_specific_data`
- `is_security_sensitive`
- `asks_for_guaranteed_timeline`
- `evidence_is_weak_or_missing`
- `safe_for_auto_answer`

Each must carry evidence: literal `matched_phrases` from the ticket text, `triggered_rules`
(policy rule keys), and `relevant_doc_ids` (subset of retrieved docs).

## Expected behaviour on the sample data

Useful as a smoke test, but never hardcode these outcomes:

- withdrawal delay question → `auto_answer`, must not promise a completion time
- 2FA reset after losing device → `needs_human_review` (security-sensitive)
- balance / transaction request → `refuse_and_redirect` (privacy-sensitive)

## Working conventions

- Keep the pipeline runnable from a clean checkout with one install and one run command.
- Keep the mock LLM provider deterministic so CI and the evaluator get stable output.
- Prompt construction is code; hash the exact prompt string for `prompt_hash`.
- Log every LLM call, including failed or repaired ones.
- Prefer small pure functions for normalization, scoring, signal detection, and decision
  logic so they are unit-testable without I/O.
- When the system design diagram arrives, record it in `docs/system-design.md` and update
  this file if it changes any of the above.

## Conventions that emerged during implementation

- **`Result<T, AppError>` everywhere.** No function in `src/` throws a domain error. `unwrap`
  exists only for the CLI and test boundary. Error identities live in `src/core/errors.ts` as
  stable snake_case keys; human text lives in `src/core/messages.ts`. Branch on the identity,
  never the message.
- **Tunable constants are named and exported** from `src/core/constants.ts` so the validator,
  the pipeline, and `design_notes.md` all cite the same numbers. The weak-evidence floor is
  0.10, the ambiguity margin 0.05, the strong-evidence bar 0.35, scores round to 4 decimals.
- **`src/decide/` is imported by both the pipeline and the validator.** The validator
  re-derives signals and decisions from raw inputs and compares. Never fork this logic.
- **Retrieval always cites at least one document.** A ticket with no lexical overlap falls back
  to the first document at score 0, which still reads as weak evidence and routes to review.
  This keeps `retrieved_doc_ids` non-empty as the schema requires.
- **The safety gate runs on the template too.** A deterministic fallback that could violate a
  rule fails the run rather than shipping.
- **Repair is per-ticket, not per-batch.** Only tickets that failed the gate are resent.
- **A model that returns `decision` or `risk_level` fails the call** with identity
  `llm_owned_decision`, even when the value agrees with the computed one. Stripping it would
  hide a model trying to own routing. See `checkNoRoutingFields`.
- **Validation has three entry points** that all run the same 37 checks: `python validate.py`
  (the command the brief names), `npm run validate`, and `make validate`.
- **Provider switch.** `LLM_PROVIDER=mock` selects a deterministic template renderer that goes
  through the same schema, gate, and call log. `npm start` with no key asks whether to use it;
  a non-interactive run exits with setup instructions rather than hanging.
- **`.env` in the working directory is read by the CLI.** Real environment values always win.
- **ESLint's unused-args rule honours the `_` prefix**, matching tsconfig, so interface-mandated
  unused parameters need no per-site disable.
