import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { runIngest } from "@/lib/ingest/pipeline";
import { brands, filterOptions, listReviews, productDetail, products, retailers, summary, themes, trend } from "@/lib/insights/queries";
import { FilterError, parseFilters, whereClause } from "@/lib/query/filters";
import { reprocess } from "@/lib/nlp/reprocess";
import { makeFixture } from "../scripts/make-fixture";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prism-insights-"));
const fixture = path.join(tmp, "sample_reviews.xlsx");
let conn: Database.Database;
const F = (qs = "") => parseFilters(new URLSearchParams(qs));

beforeAll(async () => {
  await makeFixture(fixture);
  conn = openDb(":memory:");
  const jobId = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('f', 'queued')").run().lastInsertRowid);
  await runIngest(conn, { jobId, path: fixture, kind: "xlsx", vaultKey: crypto.randomBytes(32), userId: null, role: null });
});

describe("ingest tagging", () => {
  it("tags, weights and maps every review", () => {
    const untagged = conn.prepare("SELECT COUNT(*) FROM reviews WHERE nlp_version IS NULL OR trust_weight IS NULL").pluck().get();
    expect(untagged).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews WHERE product_id IS NULL").pluck().get()).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM products").pluck().get()).toBe(6);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews WHERE is_duplicate = 1 AND trust_weight <> 0").pluck().get()).toBe(0);
    const report = JSON.parse(conn.prepare("SELECT quality_report FROM ingest_jobs").pluck().get() as string);
    expect(report.nlp.sentiment.negative).toBeGreaterThan(0);
    expect(report.nlp.themes.leak).toBeGreaterThan(0);
    expect(report.nlp.mapping.newProducts).toBe(6);
  });
});

describe("aggregates", () => {
  it("summarizes without duplicates by default", () => {
    const s = summary(conn, F());
    expect(s.reviews).toBe(198);
    expect(summary(conn, F("includeDuplicates=true")).reviews).toBe(200);
    expect(s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative).toBeLessThanOrEqual(s.withText);
    expect(s.intelligenceScore.score).toBeGreaterThan(0);
    expect(s.intelligenceScore.score).toBeLessThan(100);
    expect(s.provenance.intelligenceScore).toBe("DERIVED");
  });

  it("filters consistently across endpoints", () => {
    const neg = summary(conn, F("sentiment=negative"));
    expect(neg.sentiment.positive).toBe(0);
    expect(neg.reviews).toBe(summary(conn, F()).sentiment.negative);
    const lazada = summary(conn, F("retailer=Lazada")).reviews;
    const shop = summary(conn, F("retailer=ShopMart")).reviews;
    expect(lazada + shop).toBe(198);
    expect(summary(conn, F("retailer=Lazada&retailer=ShopMart")).reviews).toBe(198);
    const leak = listReviews(conn, F("theme=leak"), { sort: "newest", limit: 100, offset: 0 });
    expect(leak.total).toBeGreaterThan(0);
    for (const r of leak.reviews) expect(r.themes.map((t) => (t as { theme: string }).theme)).toContain("leak");
  });

  it("builds monthly and weekly trends", () => {
    const m = trend(conn, F(), "month");
    expect(m.series.length).toBeGreaterThan(10);
    expect(m.series.every((p) => /^\d{4}-\d{2}$/.test(p.period))).toBe(true);
    expect(m.series.reduce((a, p) => a + p.n, 0)).toBe(197); // one row has an invalid date
    const w = trend(conn, F(), "week");
    expect(w.series.every((p) => new Date(`${p.period}T00:00:00Z`).getUTCDay() === 1)).toBe(true); // Mondays
  });

  it("ranks themes and vectors with change windows", () => {
    const t = themes(conn, F(), 30);
    const ids = t.themes.map((x) => x.theme);
    expect(ids).toEqual(expect.arrayContaining(["scent", "leak", "price", "delivery_speed"]));
    expect(t.themes.find((x) => x.theme === "leak")!.negativeShare).toBeGreaterThan(0.5);
    expect(t.vectors.map((v) => v.vector)).toEqual(expect.arrayContaining(["Product", "Packaging", "Value", "Retail Execution"]));
    expect(t.window?.days).toBe(30);
  });

  it("scores retailers, brands and products against the filtered set", () => {
    expect(retailers(conn, F()).retailers.map((r) => r.retailer).sort()).toEqual(["Lazada", "ShopMart"]);
    const b = brands(conn, F());
    expect(b.brands.length).toBe(4);
    const p = products(conn, F(), "reviews");
    expect(p.total).toBe(6);
    expect(p.products[0]!.reviews).toBeGreaterThanOrEqual(p.products[1]!.reviews);
    for (const x of p.products) expect(x.intelligenceScore.prior).toBe(p.prior);
    const d = productDetail(conn, p.products[0]!.id, F());
    expect(d!.summary.reviews).toBe(p.products[0]!.reviews);
    expect(d!.aliases.length).toBeGreaterThan(0);
    expect(productDetail(conn, 999_999, F())).toBeNull();
  });

  it("returns redacted text only, and no review URLs", () => {
    const all = listReviews(conn, F("includeDuplicates=true"), { sort: "newest", limit: 100, offset: 0 });
    const page2 = listReviews(conn, F("includeDuplicates=true"), { sort: "newest", limit: 100, offset: 100 });
    const texts = [...all.reviews, ...page2.reviews].map((r) => String(r.text ?? ""));
    expect(texts.length).toBe(200);
    expect(texts.some((t) => /0917|@example\.com|Maria/.test(t))).toBe(false);
    expect(Object.keys(all.reviews[0]!)).not.toContain("review_url");
  });

  it("lists filter options", () => {
    const o = filterOptions(conn);
    expect(o.retailers.length).toBe(2);
    expect(o.themes.length).toBeGreaterThan(20);
    expect(o.staleReviews).toBe(0);
  });
});

describe("filters", () => {
  it("rejects unknown values and bad input", () => {
    expect(() => F("sentiment=great")).toThrow(FilterError);
    expect(() => F("theme=nope")).toThrow(FilterError);
    expect(() => F("vector=Price")).toThrow(FilterError);
    expect(() => F("from=2024-13-45")).toThrow(FilterError);
    expect(() => F("from=2024-02-01&to=2024-01-01")).toThrow(FilterError);
    expect(() => F("minRating=9")).toThrow(FilterError);
    expect(() => F("product=abc")).toThrow(FilterError);
    expect(() => F(Array.from({ length: 51 }, (_, i) => `brand=b${i}`).join("&"))).toThrow(FilterError);
  });

  it("keeps values out of the SQL text", () => {
    const evil = "x' OR 1=1; DROP TABLE reviews; --";
    const w = whereClause(F(`retailer=${encodeURIComponent(evil)}&q=${encodeURIComponent("50%_off")}`));
    expect(w.sql).not.toContain(evil);
    expect(w.params).toContain(evil);
    expect(w.params).toContain("%50\\%\\_off%");
    expect(summary(conn, F(`retailer=${encodeURIComponent(evil)}`)).reviews).toBe(0);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews").pluck().get()).toBe(200);
  });

  it("treats `to` as inclusive", () => {
    const day = (conn.prepare("SELECT substr(MIN(review_date_iso), 1, 10) FROM reviews WHERE is_duplicate = 0").pluck().get() as string);
    expect(summary(conn, F(`from=${day}&to=${day}`)).reviews).toBeGreaterThan(0);
  });
});

describe("reprocess", () => {
  it("re-tags stale reviews and keeps human tags", async () => {
    const id = conn.prepare("SELECT id FROM reviews WHERE review_text LIKE '%tumagas%' LIMIT 1").pluck().get() as number;
    conn.prepare("INSERT INTO review_themes (review_id, theme, vector, source, sentiment) VALUES (?, 'labeling', 'Communication', 'human', 'negative')").run(id);
    conn.prepare("UPDATE reviews SET nlp_version = 'old', sentiment = NULL WHERE id = ?").run(id);
    const stats = await reprocess(conn);
    expect(stats.reviews).toBe(1);
    expect(conn.prepare("SELECT sentiment FROM reviews WHERE id = ?").pluck().get(id)).toBe("negative");
    const tags = conn.prepare("SELECT theme || ':' || source FROM review_themes WHERE review_id = ? ORDER BY theme").pluck().all(id);
    expect(tags).toEqual(expect.arrayContaining(["labeling:human", "leak:rule"]));
    expect((await reprocess(conn)).reviews).toBe(0);
    expect((await reprocess(conn, { all: true })).reviews).toBe(200);
  });
});
