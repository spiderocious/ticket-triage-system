import { describe, expect, it } from "vitest";
import { unwrap } from "../src/core/result.js";
import { loadInputs } from "../src/io/load.js";
import type { Inputs, KbDoc } from "../src/core/types.js";
import { buildIndex, expandQuery, normalizeText, retrieveAll, retrieveForTicket } from "../src/retrieval/index.js";

const load = async (dir = "."): Promise<Inputs> =>
  unwrap(await loadInputs({ tickets: `${dir}/tickets.json`, kb: `${dir}/knowledge_base.json`, policy: `${dir}/response_policy.json` }));

describe("normalisation", () => {
  it("drops stopwords and punctuation", () => expect(normalizeText("Why was my withdrawal delayed?")).not.toContain("my"));
  it("keeps 2fa as one token", () => expect(normalizeText("reset my 2FA now")).toContain("2fa"));
});

describe("synonym bridge", () => {
  it("records which expansions fired", () => {
    const { expanded, fired } = expandQuery(normalizeText("my withdrawal is delayed"));
    expect(fired.length).toBeGreaterThan(0);
    expect(expanded).toContain("review");
  });
});

describe("retrieval on the sample data", () => {
  it("maps each sample ticket to its topic document", async () => {
    const inputs = await load();
    const res = retrieveAll(inputs, 3);
    expect(res.map((r) => r.retrieved[0]?.doc_id)).toEqual(["kb_001", "kb_002", "kb_003"]);
  });
  it("bridges the delay wording onto the withdrawal document", async () => {
    const inputs = await load();
    const [first] = retrieveAll(inputs, 3);
    const reasons = first?.retrieved[0]?.match_reasons ?? [];
    expect(reasons.some((r) => r.startsWith("synonym:"))).toBe(true);
  });
  it("gives every retrieved document at least one reason", async () => {
    const inputs = await load();
    for (const r of retrieveAll(inputs, 3)) for (const d of r.retrieved) expect(d.match_reasons.length).toBeGreaterThan(0);
  });
  it("is byte-identical across runs", async () => {
    const inputs = await load();
    expect(JSON.stringify(retrieveAll(inputs, 3))).toEqual(JSON.stringify(retrieveAll(inputs, 3)));
  });
  it("ranks by score desc then doc_id asc", async () => {
    const inputs = await load();
    for (const r of retrieveAll(inputs, 3)) {
      for (let i = 1; i < r.retrieved.length; i += 1) {
        const prev = r.retrieved[i - 1]!;
        const cur = r.retrieved[i]!;
        expect(prev.score >= cur.score).toBe(true);
        if (prev.score === cur.score) expect(prev.doc_id < cur.doc_id).toBe(true);
      }
    }
  });
});

describe("retrieval under an unrelated knowledge base", () => {
  const irrelevantKb: KbDoc[] = [
    { doc_id: "x_001", title: "Cafeteria menu", category: "general", content: "The cafeteria serves soup on Tuesdays and salad on Fridays.", tags: ["food"] },
    { doc_id: "x_002", title: "Bicycle parking", category: "general", content: "Bicycle racks are located behind the north entrance of the building.", tags: ["parking"] },
  ];
  it("returns nothing or only weak matches", async () => {
    const inputs = await load();
    const index = buildIndex(irrelevantKb);
    const first = inputs.tickets[0]!;
    const out = retrieveForTicket(index, first, 3);
    expect(out.every((d) => d.score < 0.1)).toBe(true);
  });
  it("breaks ties on doc_id ascending", () => {
    const twins: KbDoc[] = [
      { doc_id: "b_doc", title: "Withdrawal review", category: "payments", content: "Withdrawals may be delayed for review.", tags: ["withdrawal"] },
      { doc_id: "a_doc", title: "Withdrawal review", category: "payments", content: "Withdrawals may be delayed for review.", tags: ["withdrawal"] },
    ];
    const index = buildIndex(twins);
    const out = retrieveForTicket(index, { ticket_id: "t", created_at: "", channel: "chat", language: "en", customer_tier: "standard", subject: "withdrawal delayed", message: "why" }, 2);
    expect(out.map((d) => d.doc_id)).toEqual(["a_doc", "b_doc"]);
  });
});

describe("retrieval on the alternate fixture", () => {
  it("works with different id conventions", async () => {
    const inputs = await load("fixtures/alt");
    const res = retrieveAll(inputs, 3);
    const tops = new Map(res.map((r) => [r.ticket_id, r.retrieved[0]?.doc_id]));
    expect(tops.get("TCK-8821")).toBe("DOC-SEC-01");
    expect(tops.get("TCK-4410")).toBe("DOC-PAY-01");
    expect(tops.get("TCK-9077")).toBe("DOC-PRV-01");
  });
});
