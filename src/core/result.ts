/**
 * Result<T, E> — services return this instead of throwing domain errors.
 * Thrown exceptions are reserved for programmer errors and I/O the caller cannot recover from.
 */
import type { ErrorIdentity } from "./errors.js";

export interface AppError {
  readonly identity: ErrorIdentity;
  /** Human-readable, resolved from the message registry. */
  readonly message: string;
  /** Operator-facing detail. Never branch on it. */
  readonly detail?: string;
}

export type Result<T, E = AppError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

/** Unwrap or throw — only for the CLI / test boundary where a failure must stop the process. */
export function unwrap<T>(r: Result<T, AppError>): T {
  if (r.ok) return r.value;
  const suffix = r.error.detail ? ` (${r.error.detail})` : "";
  throw new Error(`[${r.error.identity}] ${r.error.message}${suffix}`);
}
