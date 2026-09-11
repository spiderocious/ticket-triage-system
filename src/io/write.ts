import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok, type Result } from "../core/result.js";

/** Recursively sort object keys so identical data always serialises to identical bytes. */
export function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, stableSort(o[k])]),
    );
  }
  return value;
}

export function toStableJson(value: unknown): string {
  return `${JSON.stringify(stableSort(value), null, 2)}\n`;
}

export async function writeJsonArtifact(path: string, value: unknown): Promise<Result<void>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, toStableJson(value), "utf8");
    return ok(undefined);
  } catch (e) {
    return err(appError(ERR.write_failed, `${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function appendJsonl(path: string, record: unknown): Promise<Result<void>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(stableSort(record))}\n`, "utf8");
    return ok(undefined);
  } catch (e) {
    return err(appError(ERR.write_failed, `${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function truncateFile(path: string): Promise<Result<void>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "", "utf8");
    return ok(undefined);
  } catch (e) {
    return err(appError(ERR.write_failed, `${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
}
