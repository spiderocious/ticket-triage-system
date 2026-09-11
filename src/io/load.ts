import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok, type Result } from "../core/result.js";
import type { Inputs } from "../core/types.js";
import { KbFileSchema, PolicySchema, TicketsFileSchema } from "./schemas.js";

async function readJson(path: string): Promise<Result<unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    return err(appError(ERR.input_missing, `${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch (e) {
    return err(appError(ERR.input_malformed, `${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

function parseWith<S extends z.ZodTypeAny>(schema: S, data: unknown, path: string): Result<z.infer<S>> {
  const r = schema.safeParse(data);
  if (r.success) return ok(r.data as z.infer<S>);
  const first = r.error.issues[0];
  const where = first ? `${path} at ${first.path.join(".") || "<root>"}: ${first.message}` : path;
  return err(appError(ERR.schema_violation, where));
}

function findDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

export interface InputPaths {
  tickets: string;
  kb: string;
  policy: string;
}

export async function loadInputs(paths: InputPaths): Promise<Result<Inputs>> {
  const [tRaw, kRaw, pRaw] = await Promise.all([readJson(paths.tickets), readJson(paths.kb), readJson(paths.policy)]);
  if (!tRaw.ok) return tRaw;
  if (!kRaw.ok) return kRaw;
  if (!pRaw.ok) return pRaw;

  const tickets = parseWith(TicketsFileSchema, tRaw.value, paths.tickets);
  if (!tickets.ok) return tickets;
  const kb = parseWith(KbFileSchema, kRaw.value, paths.kb);
  if (!kb.ok) return kb;
  const policy = parseWith(PolicySchema, pRaw.value, paths.policy);
  if (!policy.ok) return policy;

  const dupT = findDuplicate(tickets.value.map((t) => t.ticket_id));
  if (dupT) return err(appError(ERR.duplicate_id, `${paths.tickets}: ticket_id ${dupT}`));
  const dupK = findDuplicate(kb.value.map((d) => d.doc_id));
  if (dupK) return err(appError(ERR.duplicate_id, `${paths.kb}: doc_id ${dupK}`));

  return ok({ tickets: tickets.value, kb: kb.value, policy: policy.value });
}

/** Read any JSON artifact for the validator; returns unknown so callers narrow. */
export async function readJsonFile(path: string): Promise<Result<unknown>> {
  return readJson(path);
}
