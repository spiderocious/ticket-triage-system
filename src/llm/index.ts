import { DEFAULT_OPENAI_MODEL } from "../core/constants.js";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok } from "../core/result.js";
import type { Result } from "../core/result.js";
import { MockProvider } from "./mock.js";
import { OpenAiProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

export { buildPrompt } from "./prompt.js";
export { validateDrafts, checkNoRoutingFields } from "./validate.js";
export { makeCallRecord } from "./call-log.js";
export { DraftSchema, DraftItemSchema } from "./schema.js";
export { MockProvider } from "./mock.js";
export { OpenAiProvider } from "./openai.js";
export type { BuiltPrompt, DraftRequest, DraftTicketContext, LlmProvider } from "./types.js";

/** "openai" -> OpenAI provider (err llm_key_missing if no key), "mock" -> deterministic templates, else err llm_provider_unknown. */
export function createProvider(name: string, env: NodeJS.ProcessEnv): Result<LlmProvider> {
  if (name === "openai") {
    const key = env.OPENAI_API_KEY;
    if (!key) return err(appError(ERR.llm_key_missing));
    return ok(new OpenAiProvider(key, env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL));
  }
  if (name === "mock") return ok(new MockProvider());
  return err(appError(ERR.llm_provider_unknown, name));
}
