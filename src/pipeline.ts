import { join } from "node:path";
import { ARTIFACTS, TOP_K_DEFAULT } from "./core/constants.js";
import { ERR } from "./core/errors.js";
import { appError } from "./core/messages.js";
import { err, ok, type AppError, type Result } from "./core/result.js";
import type { Draft, FallbackRecord, LlmCallRecord, RetrievalRecord, RoutingSignals, TriageRecord } from "./core/types.js";
import { buildFallbackRecord, checkDraft, templateDraft } from "./gate/index.js";
import { loadInputs, type InputPaths } from "./io/load.js";
import { appendJsonl, truncateFile, writeJsonArtifact } from "./io/write.js";
import { buildPrompt, checkNoRoutingFields, createProvider, makeCallRecord, validateDrafts } from "./llm/index.js";
import type { DraftTicketContext } from "./llm/types.js";
import { decide } from "./decide/index.js";
import { retrieveAll } from "./retrieval/index.js";
import { buildSignals } from "./signals/index.js";
import { assessEvidence } from "./signals/evidence.js";

export interface PipelineOptions {
  paths: InputPaths;
  outDir: string;
  providerName: string;
  topK?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PipelineSummary {
  ticketCount: number;
  decisions: Record<string, number>;
  templatedTickets: string[];
  repairedTickets: string[];
  artifacts: string[];
}

const INPUT_ARTIFACT_NAMES = ["tickets.json", "knowledge_base.json", "response_policy.json", ARTIFACTS.retrieval, ARTIFACTS.signals];

export async function runPipeline(opts: PipelineOptions): Promise<Result<PipelineSummary>> {
  const env = opts.env ?? process.env;
  const topK = opts.topK ?? TOP_K_DEFAULT;
  const out = (name: string) => join(opts.outDir, name);

  // Stage 1 — load and validate.
  const loaded = await loadInputs(opts.paths);
  if (!loaded.ok) return loaded;
  const { tickets, kb, policy } = loaded.value;

  // Stages 2 and 3 — normalize, index, retrieve.
  const retrieval: RetrievalRecord[] = retrieveAll({ tickets, kb, policy }, topK);
  const wroteRetrieval = await writeJsonArtifact(out(ARTIFACTS.retrieval), retrieval);
  if (!wroteRetrieval.ok) return wroteRetrieval;

  // Stage 4 — signals, then the ladder. The decision is FINAL from here; nothing downstream may alter it.
  const signals: RoutingSignals[] = [];
  const contexts: DraftTicketContext[] = [];
  const kbById = new Map(kb.map((d) => [d.doc_id, d]));
  for (const [i, ticket] of tickets.entries()) {
    const rec = retrieval[i];
    if (!rec) return err(appError(ERR.artifact_invalid, `no retrieval record for ${ticket.ticket_id}`));
    const s = buildSignals(ticket, rec, kb, policy);
    if (!s.ok) return s;
    const d = decide(s.value, policy);
    if (!d.ok) return d;
    signals.push(s.value);
    contexts.push({
      ticket,
      retrieved: rec.retrieved.flatMap((r) => {
        const doc = kbById.get(r.doc_id);
        return doc ? [{ doc, score: r.score }] : [];
      }),
      signals: s.value,
      outcome: d.value,
    });
  }
  const wroteSignals = await writeJsonArtifact(out(ARTIFACTS.signals), signals);
  if (!wroteSignals.ok) return wroteSignals;

  // Stage 5 — one combined generation call for every ticket.
  const providerRes = createProvider(opts.providerName, env);
  if (!providerRes.ok) return providerRes;
  const provider = providerRes.value;
  const callLogPath = out(ARTIFACTS.llmCalls);
  const truncated = await truncateFile(callLogPath);
  if (!truncated.ok) return truncated;

  const logCall = async (rec: LlmCallRecord): Promise<Result<void>> => appendJsonl(callLogPath, rec);

  const expectedIds = tickets.map((t) => t.ticket_id);
  const prompt = buildPrompt({ contexts, policy });
  const raw = await provider.draft(prompt, { contexts, policy });
  // The model must not return routing fields at all. A returned decision is a bid to own the routing, so it fails the
  // call rather than being quietly stripped — whether it agrees with the computed decision or contradicts it.
  const routingCheck = raw.ok ? checkNoRoutingFields({ drafts: raw.value }, contexts, policy) : ok(undefined);
  const validated = !raw.ok ? raw : !routingCheck.ok ? routingCheck : validateDrafts({ drafts: raw.value }, expectedIds);
  const genLog = await logCall(
    makeCallRecord({
      stage: "response_generation",
      ticketId: null,
      provider: provider.name,
      model: provider.model,
      promptHash: prompt.hash,
      inputArtifacts: INPUT_ARTIFACT_NAMES,
      outputArtifact: ARTIFACTS.triage,
      ticketIds: expectedIds,
      outcome: validated.ok ? "ok" : raw.ok ? "invalid_output" : "call_failed",
    }),
  );
  if (!genLog.ok) return genLog;

  // A failed or unusable generation is not fatal: every ticket falls back to a deterministic template.
  const draftsById = new Map<string, Draft>();
  if (validated.ok) for (const d of validated.value) draftsById.set(d.ticket_id, d);
  const generationError: AppError | undefined = validated.ok ? undefined : validated.error;

  // Stage 6 — safety gate, targeted repair, deterministic substitution.
  const violationsById = new Map<string, string[]>();
  for (const ctx of contexts) {
    const d = draftsById.get(ctx.ticket.ticket_id);
    if (!d) {
      violationsById.set(ctx.ticket.ticket_id, [generationError ? `generation: ${generationError.identity}` : "generation: no draft returned"]);
      continue;
    }
    const v = checkDraft(d, ctx, policy);
    if (v.length > 0) violationsById.set(ctx.ticket.ticket_id, v);
  }

  const repairedTickets: string[] = [];
  if (violationsById.size > 0 && validated.ok) {
    // Repair only the tickets that failed, not the whole batch — tighter blast radius than resending everything.
    const repairContexts = contexts.filter((c) => violationsById.has(c.ticket.ticket_id));
    const repairNotes = Object.fromEntries([...violationsById.entries()].map(([id, v]) => [id, v]));
    const repairIds = repairContexts.map((c) => c.ticket.ticket_id);
    const repairPrompt = buildPrompt({ contexts: repairContexts, policy, repairNotes });
    const repairRaw = await provider.draft(repairPrompt, { contexts: repairContexts, policy, repairNotes });
    const repairRouting = repairRaw.ok ? checkNoRoutingFields({ drafts: repairRaw.value }, repairContexts, policy) : ok(undefined);
    const repairValidated = !repairRaw.ok ? repairRaw : !repairRouting.ok ? repairRouting : validateDrafts({ drafts: repairRaw.value }, repairIds);
    const repairLog = await logCall(
      makeCallRecord({
        stage: "response_repair",
        ticketId: repairIds.length === 1 ? (repairIds[0] ?? null) : null,
        provider: provider.name,
        model: provider.model,
        promptHash: repairPrompt.hash,
        inputArtifacts: [...INPUT_ARTIFACT_NAMES],
        outputArtifact: ARTIFACTS.triage,
        ticketIds: repairIds,
        outcome: repairValidated.ok ? "ok" : repairRaw.ok ? "invalid_output" : "call_failed",
      }),
    );
    if (!repairLog.ok) return repairLog;

    if (repairValidated.ok) {
      for (const d of repairValidated.value) {
        const ctx = contexts.find((c) => c.ticket.ticket_id === d.ticket_id);
        if (!ctx) continue;
        const v = checkDraft(d, ctx, policy);
        if (v.length === 0) {
          draftsById.set(d.ticket_id, d);
          violationsById.delete(d.ticket_id);
          repairedTickets.push(d.ticket_id);
        } else {
          violationsById.set(d.ticket_id, v);
        }
      }
    }
  }

  const templatedTickets: string[] = [];
  const fallbacks: FallbackRecord[] = [];
  const triage: TriageRecord[] = [];
  for (const ctx of contexts) {
    const id = ctx.ticket.ticket_id;
    const remaining = violationsById.get(id);
    let draft = draftsById.get(id);
    let templated = false;
    if (!draft || (remaining && remaining.length > 0)) {
      draft = templateDraft(ctx);
      templated = true;
      templatedTickets.push(id);
      // The template is code-generated, but it still has to clear the same gate.
      const check = checkDraft(draft, ctx, policy);
      if (check.length > 0) return err(appError(ERR.safety_violation, `template for ${id}: ${check.join("; ")}`));
    }
    const record: TriageRecord = {
      ticket_id: id,
      decision: ctx.outcome.decision,
      risk_level: ctx.outcome.risk_level,
      retrieved_doc_ids: ctx.retrieved.map((r) => r.doc.doc_id),
      policy_references: ctx.outcome.policy_references,
      customer_response: draft.customer_response,
      internal_reasoning_summary: draft.internal_reasoning_summary,
    };
    for (const field of policy.required_output_fields) {
      if (!(field in record)) return err(appError(ERR.required_field_unsupported, field));
    }
    triage.push(record);
    const retrievalRecord = retrieval.find((r) => r.ticket_id === id);
    const evidence = assessEvidence(retrievalRecord ?? { ticket_id: id, retrieved: [] });
    const fb = buildFallbackRecord(ctx, templated, remaining?.join("; "), evidence);
    if (fb) fallbacks.push(fb);
  }

  const wroteTriage = await writeJsonArtifact(out(ARTIFACTS.triage), triage);
  if (!wroteTriage.ok) return wroteTriage;
  const wroteFallback = await writeJsonArtifact(out(ARTIFACTS.fallback), fallbacks);
  if (!wroteFallback.ok) return wroteFallback;

  const decisions: Record<string, number> = {};
  for (const r of triage) decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;

  return ok({
    ticketCount: tickets.length,
    decisions,
    templatedTickets,
    repairedTickets,
    artifacts: [ARTIFACTS.retrieval, ARTIFACTS.signals, ARTIFACTS.triage, ARTIFACTS.llmCalls, ARTIFACTS.fallback].map(out),
  });
}
