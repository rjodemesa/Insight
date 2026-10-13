import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { runIngest } from "@/lib/ingest/pipeline";
import { parseFilters } from "@/lib/query/filters";
import { reprocess } from "@/lib/nlp/reprocess";
import { createGeminiProvider } from "@/lib/ai/gemini";
import { AIError, createMockProvider, type AIProvider, type AITask } from "@/lib/ai/provider";
import { cite, type Fact, type SourceReview } from "@/lib/ai/grounding";
import { aiSummary } from "@/lib/ai/summary";
import { ask, detectScope } from "@/lib/ai/ask";
import { aiTag, aiTagVersion, countCandidates } from "@/lib/ai/tagging";
import { decide, DecisionError, listAlerts, runAgent } from "@/lib/agent/alerts";
import { makeFixture } from "../scripts/make-fixture";

const F = (qs = "") => parseFilters(new URLSearchParams(qs));
const mock = createMockProvider();

/** A provider that answers every task with `answer(task)`, as if a model had written it. */
function scripted(answer: (task: AITask<unknown>) => unknown, model = "scripted"): AIProvider {
  return {
    name: "gemini", model, label: "Scripted",
    async run<T>(task: AITask<T>) {
      return { data: task.parse(answer(task as AITask<unknown>)), provider: "gemini", model, version: "p1", promptHash: "h", ms: 0, tokens: { prompt: null, output: null } };
    },
  };
}

// ---------------------------------------------------------------- Gemini over a fake fetch

const task: AITask<{ ok: boolean }> = {
  name: "t", system: "sys", prompt: "hello",
  schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
  parse: (raw) => ({ ok: (raw as { ok?: unknown }).ok === true }),
  mock: () => ({ ok: true }),
};

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const answer = (text: string, finishReason = "STOP") => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } });

describe("Gemini provider", () => {
  it("sends structured-output requests with the key in a header and parses the JSON answer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const p = createGeminiProvider({
      apiKey: "k-123", model: "gemini-test",
      fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return answer('{"ok":true}'); },
    });
    const res = await p.run(task);
    expect(res.data).toEqual({ ok: true });
    expect(res.tokens).toEqual({ prompt: 12, output: 3 });
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(calls[0]!.url).not.toContain("k-123");
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual(task.schema);
  });

  it("retries rate limits and server errors, then gives up with a clear error", async () => {
    let n = 0;
    const flaky = createGeminiProvider({ apiKey: "k", model: "m", sleep: async () => {}, fetch: async () => (++n < 3 ? reply(503, {}) : answer('{"ok":true}')) });
    expect((await flaky.run(task)).data.ok).toBe(true);
    expect(n).toBe(3);
    const limited = createGeminiProvider({ apiKey: "k", model: "m", sleep: async () => {}, fetch: async () => reply(429, { error: { message: "quota" } }) });
    await expect(limited.run(task)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("explains configuration problems and bad answers", async () => {
    await expect(createGeminiProvider({ apiKey: undefined, model: "m" }).run(task)).rejects.toMatchObject({ code: "not_configured" });
    const notFound = createGeminiProvider({ apiKey: "k", model: "nope", fetch: async () => reply(404, {}) });
    await expect(notFound.run(task)).rejects.toThrow(/no model called "nope"/);
    const cut = createGeminiProvider({ apiKey: "k", model: "m", fetch: async () => answer('{"ok":', "MAX_TOKENS") });
    await expect(cut.run(task)).rejects.toMatchObject({ code: "bad_response" });
    const prose = createGeminiProvider({ apiKey: "k", model: "m", fetch: async () => answer("Sure! Here you go") });
    await expect(prose.run(task)).rejects.toBeInstanceOf(AIError);
    const blocked = createGeminiProvider({ apiKey: "k", model: "m", fetch: async () => reply(200, { promptFeedback: { blockReason: "SAFETY" } }) });
    await expect(blocked.run(task)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("citations", () => {
  const facts: Fact[] = [{ id: "F1", text: "a" }, { id: "F2", text: "b" }];
  const reviews = [{ id: 42 }] as SourceReview[];
  it("keeps markers for supplied sources and removes invented ones", () => {
    const c = cite("Leaks rose [F2] [F9]. See [R42] and [R7] , not [PHONE_001].", facts, reviews);
    expect(c.text).toBe("Leaks rose [F2]. See [R42] and, not [PHONE_001].");
    expect(c.facts).toEqual(["F2"]);
    expect(c.reviews).toEqual([42]);
    expect(c.dropped).toBe(2);
  });
});

// ---------------------------------------------------------------- features over the fixture

let conn: Database.Database;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "insight-ai-"));

beforeAll(async () => {
  const fixture = path.join(tmp, "sample_reviews.xlsx");
  await makeFixture(fixture);
  conn = openDb(":memory:");
  const jobId = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('f', 'queued')").run().lastInsertRowid);
  await runIngest(conn, { jobId, path: fixture, kind: "xlsx", vaultKey: crypto.randomBytes(32), userId: null, role: null });
});

describe("AI summary", () => {
  it("is grounded: every mock point cites a supplied fact", async () => {
    const { body, result } = await aiSummary(conn, F(), "", mock);
    expect(result.provider).toBe("mock");
    expect(body.headline.facts).toEqual(["F1"]);
    expect(body.points.length).toBeGreaterThan(0);
    for (const p of body.points) expect(p.facts.length).toBeGreaterThan(0);
    expect(body.droppedCitations).toBe(0);
    expect(body.reviewsInScope).toBe(198);
  });

  it("strips citations a model invents", async () => {
    const liar = scripted(() => ({ headline: "Mostly positive [F1] [F99]", points: ["Leaks [R999999]"], caveat: "" }));
    const { body } = await aiSummary(conn, F(), "liar", liar);
    expect(body.headline.text).toBe("Mostly positive [F1]");
    expect(body.points[0]!.reviews).toEqual([]);
    expect(body.droppedCitations).toBe(2);
  });
});

describe("Ask AI", () => {
  it("narrows by the themes, brands and intent the question names", () => {
    const brand = conn.prepare("SELECT brand FROM reviews WHERE brand IS NOT NULL LIMIT 1").pluck().get() as string;
    const s = detectScope(conn, F(), `Any complaints about leaks for ${brand}?`);
    expect(s.themes).toContain("leak");
    expect(s.brands).toEqual([brand]);
    expect(s.scoped.brand).toEqual([brand]);
    expect(s.intent).toBe("negative");
    // A brand already chosen in the filters is not overridden.
    expect(detectScope(conn, F("brand=Other"), `leaks for ${brand}`).scoped.brand).toEqual(["Other"]);
  });

  it("answers from facts and reviews it was given", async () => {
    const { body } = await ask(conn, F(), "Are there complaints about leaks?", [], mock);
    expect(body.detected.themes).toContain("Leaks and spills");
    expect(body.answer.facts.length).toBeGreaterThan(0);
    expect(body.reviewsRead).toBeGreaterThan(0);
    const ids = new Set(conn.prepare("SELECT r.id FROM reviews r JOIN review_themes t ON t.review_id = r.id WHERE t.theme = 'leak'").pluck().all() as number[]);
    for (const id of body.answer.reviews) expect(ids.has(id)).toBe(true);
  });

  it("includes earlier turns in the prompt but never the vault", async () => {
    let prompt = "";
    const spy = scripted((t) => { prompt = t.prompt; return { answer: "ok [F1]", insufficient: false, followUps: [] }; });
    await ask(conn, F(), "and the scent?", [{ question: "leaks?", answer: "Some leaks." }], spy);
    expect(prompt).toContain("EARLIER IN THIS CONVERSATION");
    expect(prompt).toContain("Q: leaks?");
    expect(prompt).not.toMatch(/ciphertext|pii_vault/);
  });
});

describe("AI tagging", () => {
  it("adds AI themes beside rule tags, records its sentiment and does not redo reviews", async () => {
    const provider = scripted((t) => {
      const ids = [...t.prompt.matchAll(/\[R(\d+)\]/g)].map((m) => Number(m[1]));
      return { reviews: ids.map((id) => ({ id, sentiment: "negative", themes: [{ theme: "leak", sentiment: "negative" }, { theme: "made_up", sentiment: "negative" }] })) };
    });
    const version = aiTagVersion(provider);
    const before = countCandidates(conn, "both", version);
    expect(before).toBeGreaterThan(0);
    const rulesBefore = conn.prepare("SELECT COUNT(*) FROM review_themes WHERE source = 'rule'").pluck().get();
    const stats = await aiTag(conn, provider, { limit: 1000, batchSize: 7 });
    expect(stats.reviews).toBe(before);
    expect(stats.failedBatches).toBe(0);
    expect(stats.remaining).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM review_themes WHERE source = 'rule'").pluck().get()).toBe(rulesBefore);
    expect(conn.prepare("SELECT COUNT(*) FROM review_themes WHERE source = 'AI' AND theme = 'made_up'").pluck().get()).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews WHERE ai_version = ? AND ai_sentiment = 'negative'").pluck().get(version)).toBe(before);
    expect((await aiTag(conn, provider, { limit: 1000 })).reviews).toBe(0);

    // Reprocessing with the rules keeps AI tags.
    const ai = conn.prepare("SELECT COUNT(*) FROM review_themes WHERE source = 'AI'").pluck().get() as number;
    expect(ai).toBeGreaterThan(0);
    await reprocess(conn, { all: true });
    expect(conn.prepare("SELECT COUNT(*) FROM review_themes WHERE source = 'AI'").pluck().get()).toBe(ai);
  });

  it("skips a failed batch and retries it next run", async () => {
    const broken: AIProvider = { ...mock, model: "broken", async run() { throw new AIError("down", "upstream"); } };
    const stats = await aiTag(conn, broken, { limit: 5, batchSize: 5 });
    expect(stats.failedBatches).toBe(1);
    expect(stats.reviews).toBe(0);
    expect(stats.remaining).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- agent

describe("agent", () => {
  let db2: Database.Database;
  beforeAll(() => {
    // 300 reviews in the 90 days before the recent window with few leak complaints, then 120 recent ones with many.
    db2 = openDb(":memory:");
    db2.prepare("INSERT INTO ingest_jobs (id, filename, status) VALUES (1, 'synthetic', 'done')").run();
    db2.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (1, 'a@x', 'h', 'user')").run();
    const review = db2.prepare(
      `INSERT INTO reviews (ingest_id, retailer_name, brand, review_date_iso, review_rating, review_text, sentiment, trust_weight)
       VALUES (1, ?, 'Brand A', ?, ?, ?, ?, 1)`,
    );
    const tag = db2.prepare("INSERT INTO review_themes (review_id, theme, vector, sentiment) VALUES (?, 'leak', 'Packaging', 'negative')");
    const day = (d: number) => new Date(Date.UTC(2024, 5, 30) - d * 86_400_000).toISOString().slice(0, 10);
    db2.transaction(() => {
      for (let i = 0; i < 300; i++) {
        const leak = i % 20 === 0;
        const id = review.run(i % 2 ? "Lazada" : "ShopMart", day(30 + (i % 90)), leak ? 1 : 5, leak ? "tumagas" : "mabango", leak ? "negative" : "positive").lastInsertRowid;
        if (leak) tag.run(id);
      }
      for (let i = 0; i < 120; i++) {
        const leak = i % 3 === 0;
        const id = review.run(i % 2 ? "Lazada" : "ShopMart", day(i % 30), leak ? 1 : 5, leak ? "tumagas" : "mabango", leak ? "negative" : "positive").lastInsertRowid;
        if (leak) tag.run(id);
      }
    })();
  });

  it("proposes each detected change once, with evidence and a write-up", async () => {
    const first = await runAgent(db2, mock);
    expect(first.created).toBeGreaterThan(0);
    expect(first.aiError).toBeNull();
    const { alerts, counts } = listAlerts(db2, "proposed");
    expect(counts.proposed).toBe(first.created);
    const leak = alerts.find((a) => a.kind === "theme_rising" && a.drill.theme === "leak");
    expect(leak).toBeDefined();
    expect(leak!.severity).toBe("high");
    expect(leak!.evidence.facts[0]!.text).toMatch(/n=120/);
    expect(leak!.description).toMatch(/\[F\d+\]/);
    expect(leak!.writtenBy).toBe("mock");

    const again = await runAgent(db2, mock);
    expect(again.created).toBe(0);
    expect(again.alreadyProposed).toBe(first.detected);
  });

  it("still proposes alerts with rule text when the AI fails", async () => {
    db2.prepare("DELETE FROM alerts").run();
    const down: AIProvider = { ...mock, async run() { throw new AIError("down", "upstream"); } };
    const stats = await runAgent(db2, down);
    expect(stats.aiError).toBe("down");
    expect(stats.created).toBeGreaterThan(0);
    expect(listAlerts(db2, "proposed").alerts.every((a) => a.writtenBy === "rules" && a.description)).toBe(true);
  });

  it("records one final decision per alert", () => {
    const id = listAlerts(db2, "proposed").alerts[0]!.id;
    expect(() => decide(db2, id, 1, "maybe", "")).toThrow(DecisionError);
    expect(decide(db2, id, 1, "approve", "  confirmed   with QA ")).toEqual({ id, status: "approved", note: "confirmed with QA" });
    expect(() => decide(db2, id, 1, "dismiss", "")).toThrow(/already approved/);
    expect(() => decide(db2, 99999, 1, "dismiss", "")).toThrow(/not found/);
    const approved = listAlerts(db2, "approved").alerts[0]!;
    expect(approved.decidedBy).toBe("a@x");
  });
});

describe("prepared answers", () => {
  it("cover each sample question once, with caveats and a way to the reviews", async () => {
    const { PREPARED_ANSWERS, preparedAnswerFor } = await import("@/lib/ai/preparedAnswers");
    expect(new Set(PREPARED_ANSWERS.map((a) => a.question)).size).toBe(PREPARED_ANSWERS.length);
    for (const a of PREPARED_ANSWERS) {
      expect(a.headline && a.paragraphs.length && a.caveats.length).toBeTruthy();
      expect(Object.keys(a.drill).length).toBeGreaterThan(0);
      // Drill links must be filters the review viewer accepts.
      expect(() => parseFilters(new URLSearchParams(a.drill))).not.toThrow();
    }
    expect(preparedAnswerFor("  Are leak complaints getting worse? ")?.drill.theme).toBe("leak");
  });
});
