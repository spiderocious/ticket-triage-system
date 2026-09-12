# Test plan

How to run this project, what each command is for, and exactly what you should see.

Read the first section if nothing else. It answers "why are there three commands" and "what am I actually looking at".

---

## The short version

There is **one** command that does the actual work:

```bash
LLM_PROVIDER=mock npm start
```

Everything else is setup, checking, or optional.

| Command | Is it the product? | When you run it |
|---|---|---|
| `npm ci` | No. Dependency install. | Once, ever. Skip if `node_modules/` exists. |
| `LLM_PROVIDER=mock npm start` | **Yes. This is the pipeline.** | Every time you want to triage tickets. |
| `npm run validate` | No. A grader. | To prove the output is correct. Not part of the product. |
| `npm test` | No. Developer tests. | When changing code. |
| `python3 validate.py` | No. Alias for `npm run validate`. | Never, unless a grader insists on this exact command. |

So it is really **install once, then run one command**. The quick start in the README listed three commands as if they
were equals, which made a one-command tool look like a three-command tool. That was a documentation mistake, not a
design one.

### Why `npm run validate` exists at all

The pipeline writes five JSON files. The validator reads those files back and independently checks 37 things about
them: that every ticket got a decision, that every decision matches what the rules say it should be, that no response
leaked a balance, and so on.

It re-derives the decisions **from scratch** using the same rule engine the pipeline used, then compares. If the
pipeline ever wrote something the rules do not justify, validation fails.

You would never run this in production. It exists because the brief demanded a validation entry point, and because it
is the fastest way for a reviewer to confirm the output is trustworthy without reading the code.

### Why there is Python in a TypeScript project

There is no Python in this project. The brief specifies the validation command as `python validate.py`, so
`validate.py` exists as a five-line file that does nothing but call the TypeScript validator and pass along its exit
code.

`npm run validate` and `python3 validate.py` run **identical code** and print **identical output**. Use
`npm run validate`. The Python file is there so a grader typing the command from the brief gets a working result.

---

## Before you start

You need Node 20 or newer. Nothing else. No database, no API key, no network service.

```bash
node --version    # must be v20 or higher
npm ci            # installs dependencies, takes ~10 seconds
```

`npm ci` should end with something like `found 0 vulnerabilities`. If it errors, stop here; nothing else will work.

---

## Test 1: Run the pipeline

**Command**

```bash
LLM_PROVIDER=mock npm start
```

**What it does.** Reads the three input files at the repository root, retrieves relevant knowledge base documents for
each ticket, decides how each should be handled, drafts the customer replies, and writes five output files.

**Expected output**

```
Triaged 3 ticket(s) with provider "mock".
  auto_answer: 1
  needs_human_review: 1
  refuse_and_redirect: 1
Artifacts:
  retrieval_results.json
  routing_signals.json
  triage_results.json
  llm_calls.jsonl
  fallback_analysis.json
```

**Exit code:** 0

**What "correct" looks like.** Three tickets, one landing on each of the three possible decisions. That is the whole
point of the sample data: one ticket that can be answered, one that must go to a human, one that must be refused.

**What `LLM_PROVIDER=mock` means.** It runs without an API key by substituting a deterministic text generator for the
real language model. Every decision, every file, every safety check is identical to a real run. Only the wording of the
customer replies is templated rather than model-written. See [Test 7](#test-7-optional-run-with-a-real-model) for the
real thing.

---

## Test 2: Check the output is correct

**Command**

```bash
npm run validate
```

**Expected output**

```
Validation
  PASS  inputs load and match the schema
  PASS  retrieval_results.json exists and is valid JSON
  PASS  routing_signals.json exists and is valid JSON
  PASS  triage_results.json exists and is valid JSON
  PASS  fallback_analysis.json exists and is valid JSON
  PASS  llm_calls.jsonl exists and every line is valid JSON
  PASS  every ticket appears exactly once in retrieval_results.json
  ... 30 more lines ...
  PASS  weak evidence never auto-answers

37/37 checks passed.
OK
```

**Exit code:** 0 when all pass, 1 when any fail.

**What "correct" looks like.** `37/37 checks passed.` followed by `OK`. Every line says PASS. A failing line says FAIL
and names what went wrong.

**If you see fewer than 37 checks,** you are running an older version of the code.

---

## Test 3: Look at what it produced

This is the part that answers "what am I seeing".

### `triage_results.json` — the answer

This is the output that matters. One record per ticket.

```bash
cat triage_results.json
```

One record looks like this:

```json
{
  "ticket_id": "t001",
  "decision": "auto_answer",
  "risk_level": "medium",
  "retrieved_doc_ids": ["kb_001", "kb_002"],
  "policy_references": ["must_not_promise_unverified_timeframes"],
  "customer_response": "Thanks for getting in touch about why was my withdrawal delayed. Withdrawals may be delayed for manual review, verification checks, payment partner processing, or unusual account activity. ... We have not confirmed the status of your specific case here, so we cannot give an exact completion time. If it has not resolved, please reply and our team will look into it further.",
  "internal_reasoning_summary": "Decision auto_answer (risk medium) set by ladder_4_timeline. Policy references: must_not_promise_unverified_timeframes. Top documents: kb_001, kb_002. Retrieval confidence 0.6309."
}
```

Reading it:

| Field | What it tells you |
|---|---|
| `decision` | What to do with this ticket. One of three values. |
| `risk_level` | How risky getting it wrong would be. |
| `retrieved_doc_ids` | Which knowledge base documents the answer is based on. |
| `policy_references` | Which policy rules applied. |
| `customer_response` | What gets sent to the customer. |
| `internal_reasoning_summary` | Why, for the support agent. Not shown to the customer. |

The three sample tickets should read:

```
t001 | auto_answer         | medium | kb_001,kb_002
t002 | needs_human_review  | high   | kb_002,kb_003,kb_001
t003 | refuse_and_redirect | high   | kb_003,kb_001
```

**Why each one.** The first asks when a withdrawal will complete, which is answerable from the knowledge base, so it
auto-answers, but it is forbidden from promising a specific time. The second is about resetting two-factor
authentication, which is security-sensitive, so a human must handle it. The third asks for an account balance, which
must never be disclosed through this channel, so it is refused and the customer is redirected to the app.

### The other four files

| File | What it is | What to check |
|---|---|---|
| `retrieval_results.json` | Which documents matched each ticket and why | Every document has a score and at least one human-readable reason |
| `routing_signals.json` | Five yes/no signals per ticket, with evidence | Every `true` signal has a matched phrase or document backing it |
| `llm_calls.jsonl` | One line per call to the language model | Exactly one line for a clean run |
| `fallback_analysis.json` | Tickets where retrieval was weak | **Empty `[]` on sample data. This is correct.** See below. |

### Why `fallback_analysis.json` is empty

This file records tickets where the knowledge base match was weak enough to be worth flagging. On the sample data all
three tickets match strongly, scoring 0.63 to 0.67 against a threshold of 0.35. So there is nothing to report and the
file is an empty array.

**An empty array here is a pass, not a failure.** To see it populated, run the adversarial fixture in
[Test 5](#test-5-the-hard-cases).

---

## Test 4: Prove it is reproducible

The whole design claim is that the same inputs always produce the same decisions. Check it:

```bash
LLM_PROVIDER=mock npm start -- --out /tmp/run1
LLM_PROVIDER=mock npm start -- --out /tmp/run2
diff /tmp/run1/triage_results.json /tmp/run2/triage_results.json && echo "IDENTICAL"
```

**Expected output:** `IDENTICAL`, with no diff output above it.

> **Note the `--` before the flags.** npm needs it to know the flags are for the script, not for npm itself.
> `npm start -- --out /tmp/run1` works; `npm start --out /tmp/run1` does not.

---

## Test 5: The hard cases

The sample data is easy. The adversarial fixture is where the safety logic gets tested.

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

**Expected decisions**

```
adv-mixed-intent       refuse_and_redirect
adv-indirect-privacy   refuse_and_redirect
adv-security-urgent    needs_human_review
adv-irrelevant-kb      needs_human_review
adv-non-english        needs_human_review
adv-empty-message      needs_human_review
```

**Expected validation:** `37/37 checks passed.`

**What each case proves**

| Ticket | The trap | Correct behaviour |
|---|---|---|
| `adv-mixed-intent` | Asks a safe question *and* a forbidden one in the same message | Refuses. The stricter rule wins. |
| `adv-indirect-privacy` | Asks for a balance without using the word "balance" | Still caught and refused. |
| `adv-security-urgent` | Demands 2FA be disabled, using urgency as pressure | Escalates to a human. Urgency changes nothing. |
| `adv-irrelevant-kb` | Asks about something the knowledge base does not cover | Sends to a human rather than guessing. |
| `adv-non-english` | French, which the rules do not handle | Sends to a human. Safe default. |
| `adv-empty-message` | Empty subject and body | Does not crash. Sends to a human. |

**Now check the fallback file**

```bash
cat /tmp/adv/fallback_analysis.json
```

This one is **not** empty. Four records. One looks like:

```json
{
  "ticket_id": "adv-indirect-privacy",
  "trigger": "ambiguous_top_two",
  "action_taken": "recorded_only",
  "top_score": 0.1482,
  "second_score": 0.1063,
  "margin": 0.0419,
  "retrieval_confidence": 0.1482,
  "original_decision": "refuse_and_redirect",
  "final_decision": "refuse_and_redirect",
  "reason_not_auto_sent": "retrieval evidence was weak (ambiguous: top two scores within 0.05 and top below 0.35), but a higher-priority rule had already set refuse_and_redirect, so the decision did not change"
}
```

Read it as: the knowledge base match for this ticket was poor, two documents scored almost the same so neither was
clearly right. It did not change the outcome, because the privacy rule had already decided to refuse. But the weak
match is recorded so a reviewer can see it.

---

## Test 6: Prove it fails properly

Good software fails loudly. Check that it does.

### Missing input file

```bash
LLM_PROVIDER=mock npm start -- --tickets nope.json
```

**Expected output**

```
FAILED [input_missing] An input file could not be found.
  nope.json: ENOENT: no such file or directory, open 'nope.json'
```

**Exit code:** 1

### No API key, in a script

```bash
unset OPENAI_API_KEY
npm start < /dev/null
```

**Expected output**

```
No OPENAI_API_KEY set. To use a real model:

  1. Copy the example env file:   cp .env.example .env
  2. Add your key to .env:        OPENAI_API_KEY=sk-...
  3. Run again:                   npm start

Or run without a key at any time:  LLM_PROVIDER=mock npm start
```

**Exit code:** 1

It must exit immediately. If it hangs waiting for input, that is a bug.

### No API key, typing in a terminal

```bash
unset OPENAI_API_KEY
npm start
```

This one asks you a question, because a human is present. It explains that the mock provider writes templated text
rather than model text, then asks whether to use it. Answering `y` runs with the mock. Anything else exits with the
setup instructions.

---

## Test 7 (optional): Run with a real model

Everything above runs without an API key. This is the only test that needs one.

```bash
cp .env.example .env
# edit .env, set OPENAI_API_KEY=sk-...
npm start
npm run validate
```

**What changes:** the `customer_response` and `internal_reasoning_summary` fields become model-written prose instead of
templates.

**What does not change:** every decision, every risk level, every citation, every safety check. Those are computed in
code before the model is called.

**Expected:** the same three decisions as Test 1, and `37/37 checks passed`.

> **This is the one path not verified during development,** because no API key was available. The provider code is
> covered by unit tests against its interface, but the live call itself has not been exercised.

---

## Test 8: Developer tests

```bash
npm test
```

**Expected output**

```
 Test Files  8 passed (8)
      Tests  137 passed (137)
```

This is for changing code, not for checking output. If you only want to know whether the pipeline works, Tests 1 and 2
are enough.

Also available:

```bash
npm run typecheck   # TypeScript, should print nothing
npm run lint        # ESLint, should print nothing
```

Both print nothing when clean. Silence is success.

---

## Numbers you will see, and what they mean

| Number | Meaning | Where |
|---|---|---|
| **3** | Tickets in the sample data | Test 1 |
| **5** | Output files written | Test 1 |
| **37** | Validation checks | Test 2 |
| **137** | Developer tests | Test 8 |
| **8** | Test files | Test 8 |
| **6** | Tickets in the adversarial fixture | Test 5 |
| **4** | Fallback records on the adversarial fixture | Test 5 |
| **0** | Fallback records on sample data — correct, not a failure | Test 3 |

The two that matter for "does it work" are **37/37** and **three decisions**. The rest is detail.

---

## Full sequence, copy-paste

```bash
# setup, once
npm ci

# the product
LLM_PROVIDER=mock npm start

# prove it is correct
npm run validate

# prove it is reproducible
LLM_PROVIDER=mock npm start -- --out /tmp/run1
LLM_PROVIDER=mock npm start -- --out /tmp/run2
diff /tmp/run1/triage_results.json /tmp/run2/triage_results.json && echo IDENTICAL

# prove the safety logic holds on hard cases
LLM_PROVIDER=mock npm start -- --tickets fixtures/adversarial/tickets.json --kb fixtures/adversarial/knowledge_base.json --policy fixtures/adversarial/response_policy.json --out /tmp/adv
npm run validate -- --tickets fixtures/adversarial/tickets.json --kb fixtures/adversarial/knowledge_base.json --policy fixtures/adversarial/response_policy.json --out /tmp/adv

# prove it fails loudly
LLM_PROVIDER=mock npm start -- --tickets nope.json

# developer tests
npm test
```

Everything above should pass with no API key.

---

## Troubleshooting

**"Why did nothing happen when I passed a flag?"** npm needs `--` first:
`npm start -- --out ./out`, not `npm start --out ./out`.

**"Validation failed after I edited the input files."** The validator compares the artifacts on disk against decisions
re-derived from the *current* inputs. Change the inputs, rerun the pipeline, then validate.

**"`fallback_analysis.json` is empty."** Correct on sample data. See [Test 3](#why-fallback_analysisjson-is-empty).

**"It is asking me a question and I am in a script."** It only asks when standard input is a terminal. In a script or
CI it exits with instructions instead. If it is asking, you are in an interactive shell.

**"`python3 validate.py` says Node is required."** That file just calls the TypeScript validator. Run `npm ci` first,
or use `npm run validate` instead.

**"Which output do I actually read?"** `triage_results.json`. The rest is supporting evidence.
