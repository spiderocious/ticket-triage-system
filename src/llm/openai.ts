import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { OPENAI_SEED } from "../core/constants.js";
import { ERR } from "../core/errors.js";
import { appError } from "../core/messages.js";
import { err, ok } from "../core/result.js";
import type { Result } from "../core/result.js";
import type { Draft } from "../core/types.js";
import { DraftSchema } from "./schema.js";
import type { BuiltPrompt, DraftRequest, LlmProvider } from "./types.js";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** OpenAI-backed provider. Structured output is pinned to DraftSchema; temperature 0 and a fixed seed keep it as repeatable as the API allows. */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async draft(prompt: BuiltPrompt, _req: DraftRequest): Promise<Result<Draft[]>> {
    let completion;
    try {
      completion = await this.client.chat.completions.parse({
        model: this.model,
        temperature: 0,
        seed: OPENAI_SEED,
        response_format: zodResponseFormat(DraftSchema as unknown as Parameters<typeof zodResponseFormat>[0], "drafts"),
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });
    } catch (cause: unknown) {
      return err(appError(ERR.llm_call_failed, messageOf(cause)));
    }

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) return err(appError(ERR.llm_output_invalid, "no parsed content"));

    const result = DraftSchema.safeParse(parsed);
    if (!result.success) return err(appError(ERR.llm_output_invalid, "parsed content did not match the draft schema"));

    return ok(result.data.drafts);
  }
}
