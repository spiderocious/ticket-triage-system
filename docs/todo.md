# TODO — 0 to done

Source docs: `system-design.md` (architecture), `features.md` (scope + validation checks),
`artifacts-schema.md` (field schemas + invariants), `mvp-list.md` (acceptance stories),
`backend-engineer-skill.md` (engineering conventions).

Legend: `[ ]` pending · `[~]` in progress · `[x]` done. Tick items as they land.

---

## Decisions locked before coding

These resolve gaps or tensions between the docs. Change here first if you disagree.

- [ ] **Offline provider.** System design says `OPENAI_API_KEY` is required for `npm start`.
      `features.md` and `mvp-list.md` say the whole pipeline must run with no secret.
      Resolution: `LLM_PROVIDER=openai|mock` (default `openai`). `mock` is a deterministic
      template renderer that goes through the same schema, gate, and call log. `npm start`
      with no key and no `LLM_PROVIDER=mock` exits naming the variable, as the design says.
- [ ] **Model.** `gpt-4o-2024-08-06` per system design, overridable via `OPENAI_MODEL`.
- [ ] **Default input paths.** Repo-root `./tickets.json`, `./knowledge_base.json`,
      `./response_policy.json` per system design. Copy `raw/*.json` to the root; `raw/`
      stays as the pristine fixture source.
- [ ] **Artifact output dir.** Repo root by default, `--out <dir>` to override.
- [ ] **Validation command.** `npm run validate` (TypeScript), plus a `Makefile` with
      `validate` target so `make validate` also works. No Python.
- [ ] **Repair scope.** Repair only the failed tickets, not the whole batch
      (system design "Decisions worth revisiting", first item).
- [ ] **Risk level.** Pinned to the decision ladder row. Not a separate axis for v1.
- [ ] **Weak-evidence thresholds.** Cosine floor 0.10 and top-1 minus top-2 margin 0.05,
      both exported as named constants and stated in `design_notes.md`.
- [ ] **Module system.** Switch `package.json` to `"type": "module"` to match
      `verbatimModuleSyntax` + `nodenext` in tsconfig. Set `rootDir`/`outDir`, `types: ["node"]`.
- [ ] **Backend skill applicability.** It is HTTP/ledger oriented; this is a CLI pipeline.
      Carry over: `Result<T>` instead of thrown domain errors, stable snake_case error
      identities, message registry for user-facing strings, no `any`, `unknown` + narrowing,
      layered order (data model → service → surface), tests at the seam, write down every
      load-bearing order or exception inline. Skip: routes, pagination, money, outbox.
      The `skills/*.md` and `projects/*` it references do not exist in this repo.

---

## Phase 0 — Scaffold

- [ ] Fix `package.json`: ESM, `engines.node >= 20`, scripts `start`, `validate`, `test`,
      `typecheck`, `lint`, `build`. Remove `main: index.js`, `dev` can stay pointing at `cli.ts`.
- [ ] Fix `tsconfig.json`: `rootDir: src`, `outDir: dist`, `types: ["node"]`, drop `jsx`,
      enable `noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- [ ] Add deps: `zod`, `openai`. Dev: `vitest`, `eslint` + typescript-eslint (no-explicit-any as error).
- [ ] Add `.env.example` (`OPENAI_API_KEY=`, `OPENAI_MODEL=`, `LLM_PROVIDER=`), extend
      `.gitignore` (`dist`, `.env`, `*.local`).
- [ ] Create folder layout from system design:
      `src/{io,retrieval,signals,decide,llm,gate}`, `src/pipeline.ts`, `src/cli.ts`,
      `src/validate.ts`, `fixtures/`, `tests/`. Delete `src/index.ts`.
- [ ] Copy `raw/*.json` to repo root as default inputs.
- [ ] `Makefile` with `install`, `run`, `validate`, `test` targets delegating to npm.

## Phase 1 — Core contracts

- [ ] `src/core/result.ts`: `Result<T, E>` with `ok()` / `err()` helpers and `isOk` narrowing.
- [ ] `src/core/errors.ts`: const object of stable error identities
      (`input_missing`, `input_malformed`, `schema_violation`, `duplicate_id`,
      `llm_key_missing`, `llm_call_failed`, `llm_output_invalid`, `ticket_reconciliation_failed`,
      `safety_violation`, `artifact_missing`, `artifact_invalid`, `decision_mismatch` …).
- [ ] `src/core/messages.ts`: human text per identity. CLI and validator print from here only.
- [ ] `src/core/types.ts`: `Ticket`, `KbDoc`, `Policy`, `RetrievalRecord`, `RoutingSignals`,
      `Decision` (string, validated against policy at runtime), `TriageRecord`,
      `LlmCallRecord`, `FallbackRecord`. Types derived from zod schemas via `z.infer`.
- [ ] `src/core/constants.ts`: score precision, top-k, cosine floor, margin, artifact filenames.

## Phase 2 — IO layer

- [ ] `src/io/schemas.ts`: strict zod schemas for the three inputs. Enforce unique
      `ticket_id` / `doc_id`, non-empty arrays, `allowed_decisions` / `allowed_risk_levels`
      / `required_output_fields` non-empty, `rules` is a record of booleans.
- [ ] `src/io/load.ts`: read + parse + validate each file, return `Result`. Errors name the
      file, the path, and the first zod issue in plain language.
- [ ] `src/io/write.ts`: deterministic JSON writer (stable key order, 2-space indent,
      trailing newline). JSONL appender for `llm_calls.jsonl`. Output-dir aware.
- [ ] Unit tests: missing file, malformed JSON, schema violation, duplicate IDs, happy path.

## Phase 3 — Retrieval (deterministic)

- [ ] `src/retrieval/normalize.ts`: lowercase, strip punctuation, tokenize, stopword removal,
      light suffix stemming. Pure, tested.
- [ ] `src/retrieval/synonyms.ts`: curated map (delayed / pending / review / processing;
      2fa / two-factor / authenticator / otp; balance / transactions / statement / history;
      withdraw / withdrawal / payout; login / sign in / password …). Expansion returns
      which entries fired.
- [ ] `src/retrieval/tfidf.ts`: build index over `title + content + tags` in sorted doc_id
      order, cosine similarity. No dependencies.
- [ ] `src/retrieval/rank.ts`: expand query, score every doc, sort score desc then doc_id
      asc, round to 4 dp, take top-k, attach `match_reasons` from keyword hits, synonym
      expansions, tag hits, category hits. Non-empty reasons guaranteed for every kept doc.
- [ ] Write `retrieval_results.json`.
- [ ] Tests: byte-identical rerun, tie-break ordering, irrelevant KB yields low scores,
      synonym bridge lifts the withdrawal-delay case, empty match_reasons is impossible.

## Phase 4 — Signals and decision (deterministic)

- [ ] `src/signals/rules.ts`: phrase pattern sets per signal, each returning the literal
      matched spans.
      - account-specific data: balance, transaction(s), statement, "my account …", "how much
        do I have", last N, indirect phrasings.
      - security-sensitive: 2fa, two-factor, otp, password reset, locked out, unauthorized
        access, disable / bypass verification. Plus retrieved-doc category `security`.
      - guaranteed timeline: "when will", "how long", "by when", "exact time", "guarantee",
        "within N hours/days".
      - urgency (auxiliary evidence, not a signal): urgent, asap, immediately, right now.
- [ ] `src/signals/evidence.ts`: `evidence_is_weak_or_missing` from top score below floor
      or top-1 / top-2 margin below threshold or zero retrieved docs. Produce
      `retrieval_confidence` number for fallback analysis.
- [ ] `src/signals/build.ts`: assemble `RoutingSignals` with `matched_phrases`,
      `triggered_rules` (policy rule keys, only those present in the loaded policy),
      `relevant_doc_ids`. Assert every true boolean is traceable to at least one evidence item.
- [ ] `src/decide/ladder.ts`: pure, ordered ladder from system design
      (account data → refuse/high; security → review/high; weak evidence → review/medium;
      timeline → auto/medium; else auto/low). Decisions and risk levels emitted only if in
      policy enums; otherwise return `err(decision_not_allowed)`. Returns `policy_references`.
      Exported for reuse by validator.
- [ ] Write `routing_signals.json`.
- [ ] Tests: each ladder row, mixed-intent resolves to the restrictive branch, indirect
      privacy phrasing, security plus urgency, alternate-ID fixture set produces same
      decisions with different IDs.

## Phase 5 — LLM draft (the one model-owned stage)

- [ ] `src/llm/schema.ts`: zod `Draft` schema with only `ticket_id`, `customer_response`,
      `internal_reasoning_summary`. No decision or risk fields.
- [ ] `src/llm/prompt.ts`: system prompt with policy rules as hard constraints; user
      prompt listing every ticket with retrieved snippets, signals, the computed decision
      and risk as facts to express, and policy references. Prompt string is built
      deterministically so `prompt_hash` (sha256) is stable.
- [ ] `src/llm/provider.ts`: `LlmProvider` interface `{ name, model, draft(prompt) }`.
- [ ] `src/llm/openai.ts`: `chat.completions.parse` with `zodResponseFormat`,
      `temperature: 0`, `seed: 7`. Missing key returns `err(llm_key_missing)`.
- [ ] `src/llm/mock.ts`: deterministic template renderer per decision and retrieved docs.
      Same interface, same schema, same gate.
- [ ] `src/llm/call-log.ts`: append one `LlmCallRecord` per call with stage, ticket_id
      (null for the batch call, ticket id for a targeted repair), timestamp, provider, model,
      prompt_hash, input_artifacts, output_artifact.
- [ ] Reconcile returned ticket IDs against the input set: missing, duplicate, or unknown
      ID is `err(ticket_reconciliation_failed)`.
- [ ] Tests with the mock provider: schema rejection, reconciliation failures, call log shape.

## Phase 6 — Safety gate, repair, fallback

- [ ] `src/gate/validators.ts`: content validators keyed off the same signals.
      - privacy-flagged: no currency amounts, no transaction language, no "your balance is".
      - timeline-flagged: no exact-duration promise (`within|in|by N hour|day|minute`,
        "will complete by", "guaranteed").
      - all: no offer to disable / bypass / skip verification or 2FA.
      - refuse / review: must contain a next-step phrase.
      - all: minimum length, mentions grounding in retrieved content where decision is auto.
- [ ] `src/gate/repair.ts`: one targeted repair call for failed tickets only, naming the
      violation. Logged with stage `response_repair`.
- [ ] `src/gate/templates.ts`: deterministic fallback text per decision built from
      retrieved doc titles. Used when repair also fails. Substitution recorded.
- [ ] `src/gate/fallback.ts`: build `fallback_analysis.json` records for every ticket whose
      decision was downgraded by weak evidence or whose text was template-substituted:
      `retrieval_confidence`, `original_decision`, `final_decision`, `reason_not_auto_sent`.
- [ ] Assemble `TriageRecord` with fields driven by `required_output_fields`; fail if the
      policy lists a field the pipeline cannot supply. Write `triage_results.json`.
- [ ] Tests: each validator positive and negative, repair path, template substitution,
      fallback record emission.

## Phase 7 — Pipeline, CLI, validator

- [ ] `src/pipeline.ts`: stages 1 to 6 wired in order, each returning `Result`; first
      failure stops the run with the identity and message. Decision frozen after stage 4.
- [ ] `src/cli.ts`: flags `--tickets`, `--kb`, `--policy`, `--out`, `--provider`, `--top-k`.
      Defaults per the locked decisions. Non-zero exit on failure. Prints artifact paths.
- [ ] `src/validate.ts`: independent of pipeline output objects. Reads raw inputs and
      artifacts from disk, then checks every item in `features.md` section 5 and every
      cross-artifact invariant in `artifacts-schema.md`:
      - artifacts exist and parse
      - every ticket once in each per-ticket artifact
      - every doc_id exists in the KB
      - `retrieved_doc_ids` equals retrieval list
      - re-derive signals and decision from raw inputs via shared `decide/` and compare
      - decisions and risk levels within policy enums
      - `retrieved_doc_ids` and `policy_references` non-empty
      - privacy-flagged responses pass the privacy validator
      - timeline-flagged responses pass the timeline validator
      - `llm_calls.jsonl` has at least one `response_generation` line with required fields
      - `triage_results.json` records carry every `required_output_fields` entry
      Prints a pass / fail table, exits non-zero on any failure.
- [ ] `npm run validate` and `make validate` both wired. Neither needs an API key.

## Phase 8 — Fixtures and adversarial tests

- [ ] `fixtures/alt/`: same schema, different IDs (`TCK-…`, `DOC-…`), reordered tickets.
- [ ] `fixtures/adversarial/`: irrelevant KB, mixed-intent ticket (withdrawal question plus
      balance request), indirectly phrased privacy request ("how much came in last week"),
      security request with urgency ("urgent, disable 2FA now"), non-English ticket,
      empty message, ticket with no retrievable doc.
- [ ] `tests/pipeline.e2e.test.ts`: run full pipeline with mock provider on default,
      alt, and adversarial fixtures, then run validator on each output; assert pass.
- [ ] `tests/determinism.test.ts`: two runs, byte-compare deterministic artifacts.

## Phase 9 — Docs and handoff

- [ ] `design_notes.md`: retrieval approach and tradeoffs, deterministic vs model-owned
      table, safety failure modes, thresholds and why, production improvements
      (observability, monitoring, eval harness, per-ticket repair, embeddings behind a
      deterministic re-rank, multilingual).
- [ ] `README.md`: clean-checkout quick start, commands, env vars, artifact list, how the
      evaluator swaps fixtures, how to run with no key.
- [ ] Update `CLAUDE.md` with any convention that emerged (error identities, thresholds,
      provider switch).
- [ ] Final clean-checkout rehearsal: `git clone` to a temp dir, `npm ci`,
      `LLM_PROVIDER=mock npm start`, `npm run validate`, `npm test`. Then repeat with a
      real key once. Record results in `docs/todo.md` bottom section.

---

## Rehearsal log

| Date | Command | Result |
|---|---|---|
| | | |
