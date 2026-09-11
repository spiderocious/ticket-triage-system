import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok } from "../core/result.js";
import type { Result } from "../core/result.js";
import type { Draft } from "../core/types.js";
import { DraftSchema } from "./schema.js";

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
