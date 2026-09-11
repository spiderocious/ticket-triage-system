import { createInterface } from "node:readline/promises";
import { MOCK_MODEL_NAME } from "./core/constants.js";

export interface KeyPromptDeps {
  isInteractive: boolean;
  ask: (question: string) => Promise<string>;
  write: (text: string) => void;
}

export type KeyPromptOutcome = { kind: "use_mock" } | { kind: "abort"; message: string };

const CAVEAT = [
  "",
  "  No OPENAI_API_KEY was found in the environment or in a .env file in this folder.",
  "",
  `  Run with the built-in mock provider instead ("${MOCK_MODEL_NAME}")?`,
  "",
  "  Caveat: the mock provider writes deterministic template responses rather than",
  "  model-drafted ones. Every decision, artifact, safety check and validation still",
  "  runs exactly as it would with a real model, so the pipeline is fully exercised,",
  "  but the customer-facing wording is templated, not generated.",
  "",
].join("\n");

const SETUP_HELP = [
  "No OPENAI_API_KEY set. To use a real model:",
  "",
  "  1. Copy the example env file:   cp .env.example .env",
  "  2. Add your key to .env:        OPENAI_API_KEY=sk-...",
  "  3. Run again:                   npm start",
  "",
  "Or run without a key at any time:  LLM_PROVIDER=mock npm start",
].join("\n");

/**
 * Asks whether to fall back to the mock provider when no key is present.
 * Non-interactive callers (CI, the evaluator's scripted run) must never block on a keystroke, so they abort with the
 * setup instructions instead of waiting.
 */
export async function promptForMissingKey(deps: KeyPromptDeps): Promise<KeyPromptOutcome> {
  if (!deps.isInteractive) return { kind: "abort", message: SETUP_HELP };
  deps.write(CAVEAT);
  const answer = (await deps.ask("  Use the mock provider? [y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return { kind: "use_mock" };
  return { kind: "abort", message: SETUP_HELP };
}

export function makeTerminalDeps(): KeyPromptDeps {
  return {
    isInteractive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    write: (text) => process.stdout.write(`${text}\n`),
  };
}
