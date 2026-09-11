import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok } from "../core/result.js";
import type { Result } from "../core/result.js";
import type { Draft, Policy } from "../core/types.js";
import type { DraftTicketContext } from "./types.js";
import { DraftSchema, ForbiddenFieldsSchema } from "./schema.js";

/** Accepts `{drafts:[...]}` or a bare array (which is wrapped) so a provider that drops the envelope is still usable. */
function normalizeShape(raw: unknown): unknown {
  return Array.isArray(raw) ? { drafts: raw } : raw;
}

function describeFirstIssue(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  const first = issues[0];
  if (first === undefined) return "unknown validation failure";
  const path = first.path.map((p) => String(p)).join(".");
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}

/**
 * Validate unknown provider output against the draft schema, then reconcile ticket ids 1:1 with `expectedTicketIds`.
 * Returned drafts are ordered by `expectedTicketIds`, not by the order the provider emitted them.
 */
export function validateDrafts(raw: unknown, expectedTicketIds: string[]): Result<Draft[]> {
  const parsed = DraftSchema.safeParse(normalizeShape(raw));
  if (!parsed.success) return err(appError(ERR.llm_output_invalid, describeFirstIssue(parsed.error.issues)));

  const expected = new Set(expectedTicketIds);
  const byId = new Map<string, Draft>();
  const duplicates: string[] = [];
  const unknown: string[] = [];

  for (const draft of parsed.data.drafts) {
    if (!expected.has(draft.ticket_id)) {
      if (!unknown.includes(draft.ticket_id)) unknown.push(draft.ticket_id);
      continue;
    }
    if (byId.has(draft.ticket_id)) {
      if (!duplicates.includes(draft.ticket_id)) duplicates.push(draft.ticket_id);
      continue;
    }
    byId.set(draft.ticket_id, draft);
  }

  const missing = expectedTicketIds.filter((id) => !byId.has(id));

  if (missing.length > 0 || duplicates.length > 0 || unknown.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(",")}`);
    if (duplicates.length > 0) parts.push(`duplicate: ${duplicates.join(",")}`);
    if (unknown.length > 0) parts.push(`unknown: ${unknown.join(",")}`);
    return err(appError(ERR.ticket_reconciliation_failed, parts.join("; ")));
  }

  const ordered: Draft[] = [];
  for (const id of expectedTicketIds) {
    const draft = byId.get(id);
    if (draft !== undefined) ordered.push(draft);
  }
  return ok(ordered);
}

/**
 * The schema gives the model no `decision` or `risk_level` slot, so a well-behaved model cannot supply one. A model that
 * volunteers them anyway is contradicting deterministic code, and silently stripping the field would hide that. This
 * rejects any draft that carries routing fields, whether they agree with the computed decision or not: the model does
 * not get a vote, and an attempt to cast one is a failure worth seeing rather than discarding.
 */
export function checkNoRoutingFields(raw: unknown, contexts: DraftTicketContext[], policy: Policy): Result<void> {
  const shaped = normalizeShape(raw);
  if (typeof shaped !== "object" || shaped === null) return ok(undefined);
  const drafts = (shaped as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts)) return ok(undefined);

  const byId = new Map(contexts.map((c) => [c.ticket.ticket_id, c]));
  const offences: string[] = [];
  for (const item of drafts) {
    const parsed = ForbiddenFieldsSchema.safeParse(item);
    if (!parsed.success) continue;
    const { ticket_id, decision, risk_level } = parsed.data;
    const ctx = ticket_id === undefined ? undefined : byId.get(ticket_id);
    if (decision !== undefined) {
      const agrees = ctx !== undefined && decision === ctx.outcome.decision;
      const allowed = policy.allowed_decisions.includes(decision);
      offences.push(`${ticket_id ?? "<no id>"}: returned decision "${decision}" (${allowed ? agrees ? "agrees with" : "contradicts" : "not an allowed decision, contradicts"} the computed decision)`);
    }
    if (risk_level !== undefined) {
      const agrees = ctx !== undefined && risk_level === ctx.outcome.risk_level;
      const allowed = policy.allowed_risk_levels.includes(risk_level);
      offences.push(`${ticket_id ?? "<no id>"}: returned risk_level "${risk_level}" (${allowed ? agrees ? "agrees with" : "contradicts" : "not an allowed risk level, contradicts"} the computed risk level)`);
    }
  }
  if (offences.length > 0) return err(appError(ERR.llm_owned_decision, offences.join("; ")));
  return ok(undefined);
}
