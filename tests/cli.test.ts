import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promptForMissingKey } from "../src/cli-prompt.js";
import { loadDotEnv } from "../src/io/env.js";

describe("missing key prompt", () => {
  const deps = (answer: string, isInteractive = true) => ({ isInteractive, ask: async (): Promise<string> => answer, write: (): void => {} });

  it("uses the mock provider on yes", async () => expect((await promptForMissingKey(deps("y"))).kind).toBe("use_mock"));
  it("accepts a spelled-out yes", async () => expect((await promptForMissingKey(deps("Yes"))).kind).toBe("use_mock"));
  it("aborts on no", async () => expect((await promptForMissingKey(deps("n"))).kind).toBe("abort"));
  it("defaults to aborting on an empty answer", async () => expect((await promptForMissingKey(deps(""))).kind).toBe("abort"));
  it("never blocks a non-interactive run", async () => {
    const out = await promptForMissingKey(deps("y", false));
    expect(out.kind).toBe("abort");
    if (out.kind === "abort") expect(out.message).toContain("OPENAI_API_KEY");
  });
  it("states the mock caveat before asking", async () => {
    const written: string[] = [];
    await promptForMissingKey({ isInteractive: true, ask: async () => "n", write: (t) => written.push(t) });
    expect(written.join(" ")).toMatch(/caveat/i);
  });
});

describe(".env loading", () => {
  async function dirWith(contents: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "env-"));
    await writeFile(join(dir, ".env"), contents, "utf8");
    return dir;
  }

  it("reads simple assignments", async () => {
    const env: NodeJS.ProcessEnv = {};
    await loadDotEnv(await dirWith("LLM_PROVIDER=mock\n"), env);
    expect(env.LLM_PROVIDER).toBe("mock");
  });
  it("ignores comments and blank lines", async () => {
    const env: NodeJS.ProcessEnv = {};
    await loadDotEnv(await dirWith("# comment\n\nOPENAI_MODEL=x\n"), env);
    expect(env.OPENAI_MODEL).toBe("x");
  });
  it("strips surrounding quotes", async () => {
    const env: NodeJS.ProcessEnv = {};
    await loadDotEnv(await dirWith('OPENAI_MODEL="quoted"\n'), env);
    expect(env.OPENAI_MODEL).toBe("quoted");
  });
  it("never overrides a value already in the environment", async () => {
    const env: NodeJS.ProcessEnv = { OPENAI_MODEL: "explicit" };
    await loadDotEnv(await dirWith("OPENAI_MODEL=from-file\n"), env);
    expect(env.OPENAI_MODEL).toBe("explicit");
  });
  it("skips empty values so a placeholder does not mask a real key", async () => {
    const env: NodeJS.ProcessEnv = {};
    await loadDotEnv(await dirWith("OPENAI_API_KEY=\n"), env);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
  it("tolerates a missing .env", async () => {
    const env: NodeJS.ProcessEnv = {};
    await expect(loadDotEnv(await mkdtemp(join(tmpdir(), "env-")), env)).resolves.toBeUndefined();
  });
});
