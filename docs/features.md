## Problem Statement
Build a small, replayable AI support-triage service for a product team that needs safe, consistent answers from internal help content.

The service must ingest support tickets and a small knowledge base from local files, retrieve relevant policy snippets deterministically, decide whether the ticket can be answered automatically, and generate an auditable response package.

This is not a prompt-only task. The evaluator will run your project from a clean checkout and may replace the input files with equivalent fixtures using the same schema. Your implementation must not depend on hardcoded ticket IDs, fixed output text, or manual review steps.

The goal is to show practical AI engineering judgment: deterministic preprocessing, bounded model use, validation, fallback behavior, and clear evidence for every model-assisted decision.

---

## Input / Sample Data
Your pipeline must read these files from disk:
- `tickets.json`
- `knowledge_base.json`
- `response_policy.json`

### Sample `tickets.json`
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

### Sample `knowledge_base.json`
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

### Sample `response_policy.json`
```json
{
  "allowed_decisions": [
    "auto_answer",
    "needs_human_review",
    "refuse_and_redirect"
  ],
  "allowed_risk_levels": ["low", "medium", "high", "critical"],
  "required_output_fields": [
    "ticket_id",
    "decision",
    "risk_level",
    "retrieved_doc_ids",
    "policy_references",
    "customer_response",
    "internal_reasoning_summary"
  ],
  "rules": {
    "must_not_claim_account_specific_data": true,
    "must_not_promise_unverified_timeframes": true,
    "security_sensitive_topics_require_review": true,
    "privacy_sensitive_requests_must_be_redirected": true
  }
}
```

The evaluator may replace these files with equivalent data using the same schema.

---

## MUST COMPLETE

### 1. Deterministic Retrieval Preparation
Implement deterministic preprocessing in code. Do not ask an LLM to decide what documents exist or to fabricate citations.

Your pipeline must:
- load and validate all input files
- normalize ticket and document text
- build a deterministic retrieval method for the knowledge base
- retrieve the top relevant documents for each ticket
- save retrieval evidence to `retrieval_results.json`

You may use keyword scoring, TF-IDF, embeddings with deterministic ranking, or another documented method. If you use embeddings, the final selection logic must still be explicit and reproducible.

Each retrieval record must include:
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

### 2. Rule-Based Risk and Routing Signals
Before any LLM response generation, compute deterministic routing signals in code.

For each ticket, derive at least:
- whether the request asks for account-specific data
- whether the topic is security-sensitive
- whether the request asks for a guaranteed timeline
- whether the retrieved evidence is weak or missing
- whether the ticket is safe for automatic answering under policy

Save output to `routing_signals.json`.

Each record must include supporting evidence, such as matched phrases, triggered rules, and relevant retrieved document IDs.

### 3. Response Decision and Controlled LLM Use
Use deterministic code plus the response policy to assign one of these decisions:
- `auto_answer`
- `needs_human_review`
- `refuse_and_redirect`

The decision itself must be reproducible and implemented in code. Do not let the LLM invent the final routing decision.

Then make one combined LLM call to draft customer-facing responses and concise internal summaries for all tickets using:
- the original ticket
- retrieved snippets
- routing signals
- the deterministic decision
- the response policy

The LLM output must be validated against the allowed decisions and risk levels, and against the deterministic decision already computed in code.

Save the final structured output to `triage_results.json`.

Each final record must include:
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

### 4. Safe Response Constraints
Your generated customer responses must follow these rules:
- do not provide account-specific balances, transactions, or personal data
- do not promise an exact resolution time unless policy and evidence allow it
- do not disable or bypass security procedures
- use the retrieved knowledge base as the basis for the answer
- when refusing or escalating, explain the next step clearly and politely

### 5. Validation Command
Include a validation entry point such as:
```bash
python validate.py
```
or
```bash
make validate
```

The validation must check that:
- required artifacts exist
- JSON files are valid
- every ticket has retrieval results, routing signals, and a final result
- final decisions match the deterministic routing logic
- only allowed decisions and risk levels are used
- every final result contains retrieved document IDs and policy references
- responses for privacy-sensitive requests do not disclose account-specific data
- responses for timeline questions do not promise unsupported exact completion times
- LLM output structure is validated before finalization

---

## SHOULD ATTEMPT

### 6. Low-Evidence Fallback Behavior
If retrieval quality is weak, implement a fallback that avoids confident answering. For example:
- downgrade to `needs_human_review`
- add a retrieval-confidence field
- record why the answer was not auto-sent

Save any extra analysis to `fallback_analysis.json`.

### 7. Adversarial or Edge-Case Tests
Add a few evaluator-friendly tests or fixtures covering cases such as:
- irrelevant retrieved documents
- mixed-intent tickets
- a privacy-sensitive request phrased indirectly
- a security request combined with urgency language

### 8. Prompt and Output Hardening
Add output validation or repair logic so malformed model output does not silently pass through.

---

## STRETCH

### 9. Explainability Artifact
Generate a short `design_notes.md` describing:
- retrieval approach and tradeoffs
- deterministic vs model-owned responsibilities
- key safety failure modes
- what you would improve for production scale, observability, and monitoring

### 10. Minimal Service Interface
Expose the pipeline through a tiny local API or CLI, for example:
```bash
python main.py --tickets tickets.json --kb knowledge_base.json --policy response_policy.json
```

---

## Required Artifacts or Expected Outcome
Your repository must produce:
- `retrieval_results.json`
- `routing_signals.json`
- `triage_results.json`
- `llm_calls.jsonl`
- `validate.py` or equivalent validation command
- `fallback_analysis.json` if attempted
- `design_notes.md` if attempted

### `llm_calls.jsonl` requirements
Log one JSON object per LLM call. Each record must include:
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

---

## Tools
Any programming language may be used. Any LLM provider or local model may be used.

---

## Technical Constraints
- Retrieval and routing decisions must be implemented deterministically in code.
- The LLM may draft text, but it must not own the final routing decision.
- Final outputs must be reproducible from the same inputs.
- The implementation must handle evaluator-provided files with the same schema.
- Do not require secrets or private services to understand the solution.
- Do not use hidden manual review steps.
- Keep the solution runnable from a clean checkout.
- Do not expose or invent account-specific customer data.
- Do not rely on a single prompt without validation or guardrails.