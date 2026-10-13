import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { mapProducts } from "@/lib/mapping/products";
import { aliasesOf, MappingEditError, mappingReview, mergeProducts, splitProduct } from "@/lib/mapping/edit";
import { addRedactionFlag, addTagFeedback, FeedbackError, listFeedback } from "@/lib/feedback";
import { deleteView, listViews, MAX_VIEWS_PER_USER, saveView, ViewError } from "@/lib/views";
import { getEstimates, setEstimates } from "@/lib/settings";
import { bumpDataVersion, cached, cacheKey, TTL_MS } from "@/lib/insights/cache";
import { canonicalFilterQuery, FilterError, parseFilters, whereClause } from "@/lib/query/filters";

function setup() {
  const conn = openDb(":memory:");
  const job = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('t', 'running')").run().lastInsertRowid);
  const add = (brand: string, name: string, code: string | null = null) =>
    Number(
      conn
        .prepare("INSERT INTO reviews (ingest_id, brand, product_name, retailer_product_code, category, review_text) VALUES (?, ?, ?, ?, 'Fabric Care', 'ok')")
        .run(job, brand, name, code).lastInsertRowid,
    );
  const user = (email: string) =>
    Number(conn.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, 'x', 'user')").run(email).lastInsertRowid);
  return { conn, add, user };
}

const productOf = (conn: Database.Database, reviewId: number) =>
  conn.prepare("SELECT product_id FROM reviews WHERE id = ?").pluck().get(reviewId) as number;

describe("product merge and split", () => {
  it("merges products, moving aliases and reviews, and later imports follow the merge", async () => {
    const { conn, add } = setup();
    const a = add("SudsMax", "SudsMax Liquid Detergent 2.4L");
    const b = add("SudsMax", "SudsMax Gentle Wash 2.4L");
    await mapProducts(conn, null);
    const [pa, pb] = [productOf(conn, a), productOf(conn, b)];
    expect(pa).not.toBe(pb);

    const r = mergeProducts(conn, pa, [pb]);
    expect(r).toMatchObject({ targetId: pa, merged: [pb], reviewsMoved: 1, aliasesMoved: 1 });
    expect(productOf(conn, b)).toBe(pa);
    expect(conn.prepare("SELECT COUNT(*) FROM products WHERE id = ?").pluck().get(pb)).toBe(0);

    const c = add("SudsMax", "SudsMax Gentle Wash 2.4L");
    await mapProducts(conn, null);
    expect(productOf(conn, c)).toBe(pa);
  });

  it("splits chosen aliases and their reviews into a new product that later imports follow", async () => {
    const { conn, add } = setup();
    const a = add("SudsMax", "SudsMax Liquid Detergent 2.4L");
    const b = add("SudsMax", "SudsMax Liquid Laundry Detergent 2.4L"); // fuzzy-matched onto a
    await mapProducts(conn, null);
    const p = productOf(conn, a);
    expect(productOf(conn, b)).toBe(p);
    const aliases = aliasesOf(conn, p);
    expect(aliases).toHaveLength(2);
    const fuzzy = aliases.find((x) => x.name.includes("laundry"))!;

    const r = splitProduct(conn, p, [fuzzy.id], "SudsMax Laundry 2.4L");
    expect(r.reviewsMoved).toBe(1);
    expect(productOf(conn, b)).toBe(r.newProductId);
    expect(productOf(conn, a)).toBe(p);
    expect(conn.prepare("SELECT size_token FROM products WHERE id = ?").pluck().get(r.newProductId)).toBe("2400ml");

    const c = add("SudsMax", "SudsMax Liquid Laundry Detergent 2.4L");
    await mapProducts(conn, null);
    expect(productOf(conn, c)).toBe(r.newProductId);
  });

  it("refuses edits that would lose or invent products", async () => {
    const { conn, add } = setup();
    const a = add("SudsMax", "SudsMax Liquid Detergent 2.4L");
    await mapProducts(conn, null);
    const p = productOf(conn, a);
    expect(() => mergeProducts(conn, p, [p])).toThrow(MappingEditError);
    expect(() => mergeProducts(conn, p, [99999])).toThrow(MappingEditError);
    expect(() => splitProduct(conn, p, aliasesOf(conn, p).map((x) => x.id))).toThrow(/at least one/);
    expect(() => splitProduct(conn, p, [99999])).toThrow(MappingEditError);
    // A failed merge changes nothing.
    expect(productOf(conn, a)).toBe(p);
  });

  it("lists weakest matches first", async () => {
    const { conn, add } = setup();
    add("SudsMax", "SudsMax Liquid Detergent 2.4L");
    add("SudsMax", "SudsMax Liquid Laundry Detergent 2.4L");
    add("Bubbly", "Bubbly Bar Soap 90g");
    await mapProducts(conn, null);
    const list = mappingReview(conn, { q: null, limit: 10, offset: 0 }).products as { name: string; lowestSimilarity: number }[];
    expect(list[0]!.lowestSimilarity).toBeLessThan(1);
    expect(mappingReview(conn, { q: "bubbly", limit: 10, offset: 0 }).total).toBe(1);
  });
});

describe("feedback", () => {
  it("validates and stores tag corrections and redaction flags", () => {
    const { conn, add, user } = setup();
    const r = add("A", "A soap");
    const u = user("a@example.com");
    expect(addTagFeedback(conn, u, { reviewId: r, theme: "scent", suggested: null, comment: " sarcastic " })).toMatchObject({ theme: "scent", suggested: null });
    addTagFeedback(conn, u, { reviewId: r, theme: "sentiment", suggested: "negative", comment: null });
    expect(() => addTagFeedback(conn, u, { reviewId: r, theme: "nope", suggested: null, comment: null })).toThrow(FeedbackError);
    expect(() => addTagFeedback(conn, u, { reviewId: r, theme: "sentiment", suggested: "scent", comment: null })).toThrow(FeedbackError);
    expect(() => addTagFeedback(conn, u, { reviewId: r, theme: null, suggested: null, comment: null })).toThrow(FeedbackError);
    expect(() => addTagFeedback(conn, u, { reviewId: 999, theme: "scent", suggested: null, comment: null })).toThrow(/not found/);
    addRedactionFlag(conn, u, { reviewId: r, note: "name without cue" });
    const list = listFeedback(conn);
    expect(list.totals).toEqual({ tags: 2, redactions: 1 });
    expect(list.tags[1]!.comment).toBe("sarcastic");
    expect(list.tags[0]!.themeLabel).toBe("Sentiment");
  });
});

describe("saved views", () => {
  it("saves canonical filters, replaces by name and keeps views private", () => {
    const { conn, user } = setup();
    const [a, b] = [user("a@example.com"), user("b@example.com")];
    const v = saveView(conn, a, { name: " Leaks ", persona: "rnd", filters: "view=themes&themeSentiment=negative&theme=leak" });
    expect(v).toMatchObject({ name: "Leaks", persona: "rnd", filters: "theme=leak&themeSentiment=negative", replaced: false });
    expect(saveView(conn, a, { name: "Leaks", persona: "bogus", filters: "brand=X" })).toMatchObject({ id: v.id, persona: null, replaced: true });
    expect(listViews(conn, b).saved).toHaveLength(0);
    expect(listViews(conn, a).presets.length).toBeGreaterThan(0);
    expect(deleteView(conn, b, v.id)).toBe(false);
    expect(deleteView(conn, a, v.id)).toBe(true);
    expect(() => saveView(conn, a, { name: "x", persona: null, filters: "theme=not_a_theme" })).toThrow(FilterError);
    expect(() => saveView(conn, a, { name: "", persona: null, filters: "" })).toThrow(ViewError);
  });

  it("caps views per user", () => {
    const { conn, user } = setup();
    const a = user("a@example.com");
    for (let i = 0; i < MAX_VIEWS_PER_USER; i++) saveView(conn, a, { name: `v${i}`, persona: null, filters: "" });
    expect(() => saveView(conn, a, { name: "one more", persona: null, filters: "" })).toThrow(ViewError);
  });

  it("presets only use filters that parse", () => {
    const { conn, user } = setup();
    for (const p of listViews(conn, user("a@example.com")).presets) expect(() => parseFilters(new URLSearchParams(p.filters))).not.toThrow();
  });
});

describe("filters", () => {
  it("filters by review id and drops non-filter keys from saved queries", () => {
    const f = parseFilters(new URLSearchParams("review=5&review=7"));
    expect(f.review).toEqual([5, 7]);
    expect(whereClause(f).sql).toContain("r.id IN (?,?)");
    expect(() => parseFilters(new URLSearchParams("review=abc"))).toThrow(FilterError);
    expect(canonicalFilterQuery(new URLSearchParams("sort=helpful&offset=20&brand=B&brand=A"))).toBe("brand=B&brand=A");
  });
});

describe("estimate settings", () => {
  it("defaults, validates and saves", () => {
    const { conn } = setup();
    expect(getEstimates(conn).minutesPerRecord).toBe(1.5);
    expect(setEstimates(conn, { minutesPerRecord: 0 })).toMatch(/between/);
    expect(setEstimates(conn, { unknown: 1 })).toMatch(/Unknown/);
    expect(setEstimates(conn, { minutesPerRecord: "3" })).toBeNull();
    expect(getEstimates(conn).minutesPerRecord).toBe(3);
  });
});

describe("aggregate cache", () => {
  it("serves repeats from memory until data changes or the entry expires", () => {
    let calls = 0;
    const compute = () => ++calls;
    const key = cacheKey("/api/x", new URLSearchParams("b=2&a=1"));
    expect(key).toBe(cacheKey("/api/x", new URLSearchParams("a=1&b=2")));
    bumpDataVersion();
    expect(cached(key, compute, 0)).toBe(1);
    expect(cached(key, compute, 1000)).toBe(1);
    expect(cached(key, compute, TTL_MS + 1)).toBe(2);
    bumpDataVersion();
    expect(cached(key, compute, TTL_MS + 2)).toBe(3);
  });
});

describe("route protection", () => {
  const PUBLIC = new Set(["auth/login/route.ts", "health/route.ts"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") files.push(p);
    }
  };
  walk(path.join(process.cwd(), "app", "api"));

  it("checks the session (and so role and CSRF) in every non-public API route", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const rel = path.relative(path.join(process.cwd(), "app", "api"), file).split(path.sep).join("/");
      if (PUBLIC.has(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      expect(/\bguard\(|\breadRoute\(/.test(src), `${rel} must call guard() or readRoute()`).toBe(true);
    }
  });

  it("keeps IT-officer routes restricted", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app", "api", "admin", "pii", "reveal", "route.ts"), "utf8");
    expect(src).toContain('roles: ["it_officer"]');
  });
});
