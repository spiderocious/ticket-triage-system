/**
 * Independent re-derivation. Reads raw inputs and written artifacts from disk and re-runs the deterministic half via the
 * SAME `decide/` module the pipeline used, so drift between pipeline and validator is impossible rather than merely unlikely.
 * Needs no API key: it operates on artifacts and pure functions.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ARTIFACTS, INPUT_DEFAULTS, TOP_K_DEFAULT } from "./core/constants.js";
import type { FallbackRecord, LlmCallRecord, RetrievalRecord, RoutingSignals, TriageRecord } from "./core/types.js";
import { decide } from "./decide/index.js";
import { checkPrivacyText, checkSecurityBypassText, checkTimelineText, checkNextStep } from "./gate/index.js";
import { loadInputs, readJsonFile } from "./io/load.js";
import { retrieveAll } from "./retrieval/index.js";
import { buildSignals } from "./signals/index.js";
import { DECISION } from "./core/constants.js";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push(detail === undefined ? { name, ok } : { name, ok, detail });
}

function isRecordArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x));
}

interface Flags {
  tickets: string;
  kb: string;
  policy: string;
  out: string;
  topK: number;
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = { tickets: INPUT_DEFAULTS.tickets, kb: INPUT_DEFAULTS.kb, policy: INPUT_DEFAULTS.policy, out: ".", topK: TOP_K_DEFAULT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const n = argv[i + 1];
    if (n === undefined) continue;
    if (a === "--tickets") f.tickets = n;
    else if (a === "--kb") f.kb = n;
    else if (a === "--policy") f.policy = n;
    else if (a === "--out") f.out = n;
    else if (a === "--top-k") f.topK = Number.parseInt(n, 10) || TOP_K_DEFAULT;
    else continue;
    i += 1;
  }
  return f;
}

export async function validate(flags: Flags): Promise<boolean> {
  results.length = 0;
  const out = (n: string) => join(flags.out, n);

  const inputs = await loadInputs({ tickets: flags.tickets, kb: flags.kb, policy: flags.policy });
  check("inputs load and match the schema", inputs.ok, inputs.ok ? undefined : `${inputs.error.identity}: ${inputs.error.detail ?? ""}`);
  if (!inputs.ok) return report();
  const { tickets, kb, policy } = inputs.value;
  const kbIds = new Set(kb.map((d) => d.doc_id));
  const ticketIds = tickets.map((t) => t.ticket_id);

  // --- artifacts exist and parse ---
  const raw: Record<string, unknown> = {};
  for (const name of [ARTIFACTS.retrieval, ARTIFACTS.signals, ARTIFACTS.triage, ARTIFACTS.fallback]) {
    const r = await readJsonFile(out(name));
    check(`${name} exists and is valid JSON`, r.ok, r.ok ? undefined : r.error.detail);
    if (r.ok) raw[name] = r.value;
  }
  let callLines: LlmCallRecord[] = [];
  try {
    const text = await readFile(out(ARTIFACTS.llmCalls), "utf8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    callLines = lines.map((l) => JSON.parse(l) as LlmCallRecord);
    check(`${ARTIFACTS.llmCalls} exists and every line is valid JSON`, true);
  } catch (e) {
    check(`${ARTIFACTS.llmCalls} exists and every line is valid JSON`, false, e instanceof Error ? e.message : String(e));
  }
  if (!isRecordArray(raw[ARTIFACTS.retrieval]) || !isRecordArray(raw[ARTIFACTS.signals]) || !isRecordArray(raw[ARTIFACTS.triage])) {
    check("artifacts are arrays of records", false);
    return report();
  }
  const retrieval = raw[ARTIFACTS.retrieval] as unknown as RetrievalRecord[];
  const signals = raw[ARTIFACTS.signals] as unknown as RoutingSignals[];
  const triage = raw[ARTIFACTS.triage] as unknown as TriageRecord[];
  const fallback = (isRecordArray(raw[ARTIFACTS.fallback]) ? raw[ARTIFACTS.fallback] : []) as unknown as FallbackRecord[];

  // --- coverage: every ticket exactly once in each artifact ---
  for (const [name, arr] of [[ARTIFACTS.retrieval, retrieval], [ARTIFACTS.signals, signals], [ARTIFACTS.triage, triage]] as const) {
    const ids = arr.map((r) => r.ticket_id);
    const missing = ticketIds.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !ticketIds.includes(id));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    check(`every ticket appears exactly once in ${name}`, missing.length === 0 && extra.length === 0 && dupes.length === 0,
      [missing.length ? `missing ${missing.join(",")}` : "", extra.length ? `unknown ${extra.join(",")}` : "", dupes.length ? `duplicate ${dupes.join(",")}` : ""].filter(Boolean).join("; ") || undefined);
  }

  // --- retrieval integrity ---
  const badDoc = retrieval.flatMap((r) => r.retrieved.filter((d) => !kbIds.has(d.doc_id)).map((d) => `${r.ticket_id}:${d.doc_id}`));
  check("every retrieved doc_id exists in the knowledge base", badDoc.length === 0, badDoc.join(", ") || undefined);
  const emptyReasons = retrieval.flatMap((r) => r.retrieved.filter((d) => !Array.isArray(d.match_reasons) || d.match_reasons.length === 0).map((d) => `${r.ticket_id}:${d.doc_id}`));
  check("every retrieved doc carries at least one match reason", emptyReasons.length === 0, emptyReasons.join(", ") || undefined);
  const badOrder = retrieval.filter((r) => r.retrieved.some((d, i) => {
    const prev = r.retrieved[i - 1];
    return prev !== undefined && (d.score > prev.score || (d.score === prev.score && d.doc_id < prev.doc_id));
  })).map((r) => r.ticket_id);
  check("retrieval is ranked by score desc then doc_id asc", badOrder.length === 0, badOrder.join(", ") || undefined);

  // --- re-derive retrieval, signals and decisions from the raw inputs ---
  const rederivedRetrieval = retrieveAll({ tickets, kb, policy }, flags.topK);
  check("retrieval re-derives byte-identically from the inputs", JSON.stringify(rederivedRetrieval) === JSON.stringify(retrieval.map((r) => ({ ticket_id: r.ticket_id, retrieved: r.retrieved.map((d) => ({ doc_id: d.doc_id, score: d.score, match_reasons: d.match_reasons })) }))));

  const signalMismatches: string[] = [];
  const decisionMismatches: string[] = [];
  const riskMismatches: string[] = [];
  const evidenceGaps: string[] = [];
  for (const [i, ticket] of tickets.entries()) {
    const rec = rederivedRetrieval[i];
    const written = signals.find((s) => s.ticket_id === ticket.ticket_id);
    const final = triage.find((t) => t.ticket_id === ticket.ticket_id);
    if (!rec || !written || !final) continue;
    const s = buildSignals(ticket, rec, kb, policy);
    if (!s.ok) { signalMismatches.push(`${ticket.ticket_id}: ${s.error.identity}`); continue; }
    for (const key of ["asks_for_account_specific_data", "is_security_sensitive", "asks_for_guaranteed_timeline", "evidence_is_weak_or_missing", "safe_for_auto_answer"] as const) {
      if (s.value[key] !== written[key]) signalMismatches.push(`${ticket.ticket_id}.${key}`);
    }
    // Each true boolean must be traceable to evidence carried on the record itself.
    const hasEvidence = written.matched_phrases.length > 0 || written.triggered_rules.length > 0 || written.relevant_doc_ids.length > 0;
    for (const key of ["asks_for_account_specific_data", "is_security_sensitive", "asks_for_guaranteed_timeline"] as const) {
      if (written[key] && !hasEvidence) evidenceGaps.push(`${ticket.ticket_id}.${key}`);
    }
    if (written.evidence_is_weak_or_missing && typeof written.retrieval_confidence !== "number") evidenceGaps.push(`${ticket.ticket_id}.evidence_is_weak_or_missing`);

    const d = decide(s.value, policy);
    if (!d.ok) { decisionMismatches.push(`${ticket.ticket_id}: ${d.error.identity}`); continue; }
    if (d.value.decision !== final.decision) decisionMismatches.push(`${ticket.ticket_id}: expected ${d.value.decision}, wrote ${final.decision}`);
    if (d.value.risk_level !== final.risk_level) riskMismatches.push(`${ticket.ticket_id}: expected ${d.value.risk_level}, wrote ${final.risk_level}`);
  }
  check("routing signals re-derive from the inputs", signalMismatches.length === 0, signalMismatches.join(", ") || undefined);
  check("every true routing signal is backed by evidence", evidenceGaps.length === 0, evidenceGaps.join(", ") || undefined);
  check("final decisions match the deterministic re-derivation", decisionMismatches.length === 0, decisionMismatches.join(", ") || undefined);
  check("final risk levels match the deterministic re-derivation", riskMismatches.length === 0, riskMismatches.join(", ") || undefined);

  // --- policy enum conformance and required fields ---
  const badDecisions = triage.filter((t) => !policy.allowed_decisions.includes(t.decision)).map((t) => `${t.ticket_id}:${t.decision}`);
  check("only allowed decisions are used", badDecisions.length === 0, badDecisions.join(", ") || undefined);
  const badRisks = triage.filter((t) => !policy.allowed_risk_levels.includes(t.risk_level)).map((t) => `${t.ticket_id}:${t.risk_level}`);
  check("only allowed risk levels are used", badRisks.length === 0, badRisks.join(", ") || undefined);
  const missingFields = triage.flatMap((t) => policy.required_output_fields.filter((f) => !(f in t)).map((f) => `${t.ticket_id}.${f}`));
  check("every final record carries the policy's required output fields", missingFields.length === 0, missingFields.join(", ") || undefined);
  const emptyRefs = triage.filter((t) => !Array.isArray(t.policy_references) || t.policy_references.length === 0).map((t) => t.ticket_id);
  check("every final record carries non-empty policy references", emptyRefs.length === 0, emptyRefs.join(", ") || undefined);
  const unknownRefs = triage.flatMap((t) => t.policy_references.filter((r) => !(r in policy.rules)).map((r) => `${t.ticket_id}:${r}`));
  check("policy references are keys from the policy rules", unknownRefs.length === 0, unknownRefs.join(", ") || undefined);

  // --- retrieved_doc_ids agree with retrieval_results ---
  const docMismatch = triage.filter((t) => {
    const r = retrieval.find((x) => x.ticket_id === t.ticket_id);
    return !r || JSON.stringify(r.retrieved.map((d) => d.doc_id)) !== JSON.stringify(t.retrieved_doc_ids);
  }).map((t) => t.ticket_id);
  check("retrieved_doc_ids match retrieval_results for each ticket", docMismatch.length === 0, docMismatch.join(", ") || undefined);
  const emptyDocs = triage.filter((t) => t.retrieved_doc_ids.length === 0).map((t) => t.ticket_id);
  check("every final record carries at least one retrieved doc id", emptyDocs.length === 0, emptyDocs.join(", ") || undefined);

  // --- safety of the generated text ---
  const privacyFails: string[] = [];
  const timelineFails: string[] = [];
  const bypassFails: string[] = [];
  const nextStepFails: string[] = [];
  for (const t of triage) {
    const s = signals.find((x) => x.ticket_id === t.ticket_id);
    const p = checkPrivacyText(t.customer_response);
    if (p.length > 0) privacyFails.push(`${t.ticket_id}: ${p[0]}`);
    if (s?.asks_for_guaranteed_timeline === true || t.decision === DECISION.auto) {
      const tl = checkTimelineText(t.customer_response);
      if (tl.length > 0) timelineFails.push(`${t.ticket_id}: ${tl[0]}`);
    }
    const b = checkSecurityBypassText(t.customer_response);
    if (b.length > 0) bypassFails.push(`${t.ticket_id}: ${b[0]}`);
    if (t.decision === DECISION.refuse || t.decision === DECISION.review) {
      const n = checkNextStep(t.customer_response);
      if (n.length > 0) nextStepFails.push(t.ticket_id);
    }
  }
  check("no response discloses account-specific data", privacyFails.length === 0, privacyFails.join("; ") || undefined);
  check("no timeline response promises an unsupported completion time", timelineFails.length === 0, timelineFails.join("; ") || undefined);
  check("no response offers to bypass a security procedure", bypassFails.length === 0, bypassFails.join("; ") || undefined);
  check("every refusal or escalation states a next step", nextStepFails.length === 0, nextStepFails.join(", ") || undefined);
  const emptyText = triage.filter((t) => t.customer_response.trim() === "" || t.internal_reasoning_summary.trim() === "").map((t) => t.ticket_id);
  check("every final record has a customer response and an internal summary", emptyText.length === 0, emptyText.join(", ") || undefined);

  // --- llm_calls.jsonl ---
  const required = ["stage", "ticket_id", "timestamp", "provider", "model", "prompt_hash", "input_artifacts", "output_artifact"];
  const gen = callLines.filter((c) => c.stage === "response_generation");
  check("llm_calls.jsonl records at least one response_generation call", gen.length >= 1);
  const badCalls = callLines.filter((c) => required.some((k) => !(k in c))).map((c) => c.stage);
  check("every llm call record carries the required fields", badCalls.length === 0, badCalls.join(", ") || undefined);
  const badTicketRef = callLines.filter((c) => c.ticket_id !== null && !ticketIds.includes(c.ticket_id)).map((c) => String(c.ticket_id));
  check("llm call ticket references are null or a known ticket", badTicketRef.length === 0, badTicketRef.join(", ") || undefined);

  // --- fallback analysis ---
  const badFallbackIds = fallback.filter((f) => !ticketIds.includes(f.ticket_id)).map((f) => f.ticket_id);
  check("fallback_analysis references only known tickets", badFallbackIds.length === 0, badFallbackIds.join(", ") || undefined);
  const weakNotAuto = signals.filter((s) => s.evidence_is_weak_or_missing).map((s) => triage.find((t) => t.ticket_id === s.ticket_id)).filter((t) => t?.decision === DECISION.auto).map((t) => t?.ticket_id ?? "");
  check("weak evidence never auto-answers", weakNotAuto.length === 0, weakNotAuto.join(", ") || undefined);

  return report();
}

function report(): boolean {
  const pass = results.filter((r) => r.ok).length;
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map((r) => `  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}${r.ok || !r.detail ? "" : `   ${r.detail}`}`);
  const allOk = pass === results.length;
  process.stdout.write(`\nValidation\n${lines.join("\n")}\n\n${pass}/${results.length} checks passed.\n${allOk ? "OK\n" : "FAILED\n"}`);
  return allOk;
}

const isMain = process.argv[1]?.endsWith("validate.ts") === true || process.argv[1]?.endsWith("validate.js") === true;
if (isMain) {
  const ok = await validate(parseArgs(process.argv.slice(2)));
  process.exitCode = ok ? 0 : 1;
}
