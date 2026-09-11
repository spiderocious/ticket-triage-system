import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTIFACTS, DECISION, MOCK_PROVIDER_NAME } from "../src/core/constants.js";
import type { FallbackRecord, LlmCallRecord, RetrievalRecord, RoutingSignals, TriageRecord } from "../src/core/types.js";
import { runPipeline } from "../src/pipeline.js";
import { validate } from "../src/validate.js";

const FIXTURES = {
  sample: { tickets: "tickets.json", kb: "knowledge_base.json", policy: "response_policy.json" },
  alt: { tickets: "fixtures/alt/tickets.json", kb: "fixtures/alt/knowledge_base.json", policy: "fixtures/alt/response_policy.json" },
  adversarial: { tickets: "fixtures/adversarial/tickets.json", kb: "fixtures/adversarial/knowledge_base.json", policy: "fixtures/adversarial/response_policy.json" },
} as const;

async function run(paths: (typeof FIXTURES)[keyof typeof FIXTURES]): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "triage-"));
  const res = await runPipeline({ paths, outDir, providerName: MOCK_PROVIDER_NAME, env: {} });
  if (!res.ok) throw new Error(`${res.error.identity}: ${res.error.detail ?? ""}`);
  return outDir;
}
const readArtifact = async <T>(dir: string, name: string): Promise<T> => JSON.parse(await readFile(join(dir, name), "utf8")) as T;

describe.each(Object.entries(FIXTURES))("end to end on the %s fixture", (_name, paths) => {
  it("produces artifacts that pass every validation check", async () => {
    const outDir = await run(paths);
    const spy: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => (spy.push(String(chunk)), true);
    let passed = false;
    try {
      passed = await validate({ ...paths, out: outDir, topK: 3 });
    } finally {
      process.stdout.write = write;
    }
    expect(spy.join("")).not.toContain("  FAIL");
    expect(passed).toBe(true);
  });

  it("writes one record per ticket in every per-ticket artifact", async () => {
    const outDir = await run(paths);
    const tickets = JSON.parse(await readFile(paths.tickets, "utf8")) as Array<{ ticket_id: string }>;
    const ids = tickets.map((t) => t.ticket_id);
    for (const name of [ARTIFACTS.retrieval, ARTIFACTS.signals, ARTIFACTS.triage]) {
      const arr = await readArtifact<Array<{ ticket_id: string }>>(outDir, name);
      expect(arr.map((r) => r.ticket_id).sort()).toEqual([...ids].sort());
    }
  });

  it("never auto-answers on weak evidence", async () => {
    const outDir = await run(paths);
    const signals = await readArtifact<RoutingSignals[]>(outDir, ARTIFACTS.signals);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    for (const s of signals.filter((x) => x.evidence_is_weak_or_missing)) {
      expect(triage.find((t) => t.ticket_id === s.ticket_id)?.decision).not.toBe(DECISION.auto);
    }
  });

  it("logs a combined generation call covering every ticket", async () => {
    const outDir = await run(paths);
    const lines = (await readFile(join(outDir, ARTIFACTS.llmCalls), "utf8")).split("\n").filter((l) => l.trim() !== "");
    const calls = lines.map((l) => JSON.parse(l) as LlmCallRecord);
    const gen = calls.filter((c) => c.stage === "response_generation");
    expect(gen).toHaveLength(1);
    expect(gen[0]?.ticket_id).toBeNull();
    for (const key of ["stage", "ticket_id", "timestamp", "provider", "model", "prompt_hash", "input_artifacts", "output_artifact"]) {
      expect(gen[0]).toHaveProperty(key);
    }
  });

  it("cites at least one retrieved document for every ticket", async () => {
    const outDir = await run(paths);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    for (const t of triage) expect(t.retrieved_doc_ids.length).toBeGreaterThan(0);
  });
});

describe("adversarial behaviour", () => {
  it("routes the mixed-intent ticket to the restrictive branch", async () => {
    const outDir = await run(FIXTURES.adversarial);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    expect(triage.find((t) => t.ticket_id === "adv-mixed-intent")?.decision).toBe(DECISION.refuse);
  });
  it("does not auto-answer an indirectly phrased privacy request", async () => {
    const outDir = await run(FIXTURES.adversarial);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    expect(triage.find((t) => t.ticket_id === "adv-indirect-privacy")?.decision).not.toBe(DECISION.auto);
  });
  it("escalates a security request dressed in urgency rather than complying", async () => {
    const outDir = await run(FIXTURES.adversarial);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    const rec = triage.find((t) => t.ticket_id === "adv-security-urgent");
    expect(rec?.decision).toBe(DECISION.review);
    expect(rec?.customer_response ?? "").not.toMatch(/\b(disabled|turned off|bypassed)\b/i);
  });
  it("records why a weakly-evidenced ticket was not auto-sent", async () => {
    const outDir = await run(FIXTURES.adversarial);
    const fallback = await readArtifact<FallbackRecord[]>(outDir, ARTIFACTS.fallback);
    const rec = fallback.find((f) => f.ticket_id === "adv-irrelevant-kb");
    expect(rec?.final_decision).toBe(DECISION.review);
    expect(rec?.reason_not_auto_sent ?? "").toMatch(/weak|missing/i);
  });
  it("handles an empty ticket without crashing", async () => {
    const outDir = await run(FIXTURES.adversarial);
    const triage = await readArtifact<TriageRecord[]>(outDir, ARTIFACTS.triage);
    const rec = triage.find((t) => t.ticket_id === "adv-empty-message");
    expect(rec?.decision).toBe(DECISION.review);
    expect((rec?.customer_response ?? "").length).toBeGreaterThan(40);
  });
});

describe("determinism", () => {
  it("produces identical deterministic artifacts across two runs", async () => {
    const [a, b] = await Promise.all([run(FIXTURES.sample), run(FIXTURES.sample)]);
    for (const name of [ARTIFACTS.retrieval, ARTIFACTS.signals, ARTIFACTS.triage, ARTIFACTS.fallback]) {
      expect(await readFile(join(a, name), "utf8")).toEqual(await readFile(join(b, name), "utf8"));
    }
  });
  it("keeps the prompt hash stable across runs", async () => {
    const [a, b] = await Promise.all([run(FIXTURES.sample), run(FIXTURES.sample)]);
    const hash = async (dir: string): Promise<string> => {
      const line = (await readFile(join(dir, ARTIFACTS.llmCalls), "utf8")).split("\n").filter((l) => l.trim() !== "")[0] ?? "";
      return (JSON.parse(line) as LlmCallRecord).prompt_hash;
    };
    expect(await hash(a)).toEqual(await hash(b));
  });
  it("retrieval scores are rounded to a fixed precision", async () => {
    const outDir = await run(FIXTURES.sample);
    const retrieval = await readArtifact<RetrievalRecord[]>(outDir, ARTIFACTS.retrieval);
    for (const r of retrieval) for (const d of r.retrieved) expect(d.score).toBe(Number(d.score.toFixed(4)));
  });
});

describe("input validation", () => {
  it("fails clearly when an input file is missing", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "triage-"));
    const res = await runPipeline({ paths: { ...FIXTURES.sample, tickets: "does-not-exist.json" }, outDir, providerName: MOCK_PROVIDER_NAME, env: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.identity).toBe("input_missing");
  });
});
