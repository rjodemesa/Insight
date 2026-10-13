import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { runIngest } from "@/lib/ingest/pipeline";
import { parseFilters } from "@/lib/query/filters";
import { listReviews, summary } from "@/lib/insights/queries";
import { reprocess } from "@/lib/nlp/reprocess";
import { brandComparison, ratingSummary } from "@/lib/insights/ratings";
import { MIXED_STRENGTH, queue, reliabilityBands, unverify, verify, VerifyError } from "@/lib/verify";
import { makeFixture } from "../scripts/make-fixture";

const F = (qs = "") => parseFilters(new URLSearchParams(qs));
const Q = { threshold: 0.31, mixed: true, conflict: true, sort: "uncertain" as const, limit: 50, offset: 0 };
let conn: Database.Database;
let user: number;

beforeAll(async () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prism-verify-")), "sample_reviews.xlsx");
  await makeFixture(fixture);
  conn = openDb(":memory:");
  user = Number(conn.prepare("INSERT INTO users (email, password_hash, role) VALUES ('v@x.ph', 'h', 'user')").run().lastInsertRowid);
  const jobId = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('f', 'queued')").run().lastInsertRowid);
  await runIngest(conn, { jobId, path: fixture, kind: "xlsx", vaultKey: crypto.randomBytes(32), userId: null, role: null });
});

describe("rating filters", () => {
  it("filters by comments and photos, and counts every star chip", () => {
    const withText = listReviews(conn, F("hasText=true"), { sort: "newest", limit: 100, offset: 0 });
    expect(withText.reviews.every((r) => r.text)).toBe(true);
    expect(listReviews(conn, F("hasText=true"), { sort: "newest", limit: 1, offset: 0 }).total + listReviews(conn, F("hasText=false"), { sort: "newest", limit: 1, offset: 0 }).total).toBe(198);
    expect(() => F("hasPhotos=maybe")).toThrow();
    const r = ratingSummary(conn, F("minRating=5&maxRating=5&hasText=true"));
    // The chips' own filters are ignored, so all 198 reviews are counted.
    expect(r.total).toBe(198);
    expect(r.rated + r.noRating).toBe(198);
    expect(r.stars.map((s) => s.star)).toEqual([5, 4, 3, 2, 1]);
    expect(r.stars.reduce((a, s) => a + s.reviews, 0)).toBe(r.rated);
    expect(summary(conn, F("minRating=1&maxRating=1")).reviews).toBe(r.stars.find((s) => s.star === 1)!.reviews);
  });
});

describe("brand comparison", () => {
  it("splits visibility across brands and only flags clear, significant gaps", () => {
    const db2 = openDb(":memory:");
    db2.prepare("INSERT INTO ingest_jobs (id, filename, status) VALUES (1, 'x', 'done')").run();
    const ins = db2.prepare("INSERT INTO reviews (ingest_id, brand, review_rating) VALUES (1, ?, ?)");
    db2.transaction(() => {
      for (let i = 0; i < 600; i++) ins.run("Steady", i % 25 === 0 ? 1 : 5); // 4.84 average
      for (let i = 0; i < 400; i++) ins.run("Weak", i % 5 === 0 ? 1 : 5); // 4.2 average
      for (let i = 0; i < 40; i++) ins.run("Small", 5); // all 5★, but only 40 ratings
      for (let i = 0; i < 10; i++) ins.run("Tiny", 5);
    })();
    const c = brandComparison(db2, F());
    expect(c.totalReviews).toBe(1050);
    expect(c.brands.reduce((a, b) => a + (b.visibility ?? 0), 0)).toBeCloseTo(1, 3);
    const by = (n: string) => c.brands.find((b) => b.brand === n)!;
    expect(by("Weak").verdict).toBe("under");
    expect(by("Steady").verdict).toBe("over");
    // All 5★ has no spread of its own; it borrows the portfolio's, so its z stays moderate
    // (without that floor it would be in the hundreds). 10 ratings are too few to judge.
    expect(Math.abs(by("Small").z!)).toBeLessThan(5);
    expect(by("Tiny").verdict).toBe("too_few");
    expect(by("Steady").stars[1]).toBe(24);
  });
});

describe("verification queue", () => {
  it("lists uncertain reviews with their reasons, most uncertain first", () => {
    const q = queue(conn, F(), Q);
    expect(q.total).toBeGreaterThan(0);
    for (const r of q.reviews) {
      expect(r.verifiedAt).toBeNull();
      expect(r.reasons.length).toBeGreaterThan(0);
      const unreadable = (r.confidence ?? 1) <= 0.3;
      const mixed = !unreadable && Math.abs(r.sentimentScore ?? 0) < MIXED_STRENGTH;
      expect(unreadable || mixed || r.ratingTextConflict === 1).toBe(true);
    }
    const wide = queue(conn, F(), { ...Q, threshold: 0.75, mixed: false, conflict: false });
    expect(wide.total).toBe(wide.counts.belowThreshold);
    expect(queue(conn, F(), { ...Q, threshold: null, mixed: false, conflict: false }).total).toBe(0);
    const bands = reliabilityBands(conn, F());
    expect(bands.bands.reduce((a, b) => a + b.reviews, 0)).toBe(bands.total);
    expect(bands.bands.at(-1)!.cumulativeShare).toBe(1);
  });

  it("applies a verdict everywhere, keeps it through reprocessing, and can undo it", async () => {
    const target = queue(conn, F(), Q).reviews[0]!;
    const before = summary(conn, F()).sentiment;
    const verdict = target.sentiment === "negative" ? "positive" : "negative";
    verify(conn, user, target.id, verdict);
    expect(queue(conn, F(), Q).reviews.some((r) => r.id === target.id)).toBe(false);
    const row = () => conn.prepare("SELECT sentiment, tag_source, verified_by, confidence FROM reviews WHERE id = ?").get(target.id) as Record<string, unknown>;
    expect(row()).toMatchObject({ sentiment: verdict, tag_source: "human", verified_by: user, confidence: 1 });
    expect(summary(conn, F()).sentiment[verdict]).toBe(before[verdict] + 1);
    expect(() => verify(conn, user, target.id, "positive")).toThrow(/already verified/);

    await reprocess(conn, { all: true });
    expect(row().sentiment).toBe(verdict);

    unverify(conn, target.id);
    expect(row()).toMatchObject({ sentiment: target.sentiment, tag_source: "rule", verified_by: null });
    expect(() => unverify(conn, target.id)).toThrow(VerifyError);
  });

  it("takes unreadable reviews out of sentiment but not out of ratings", () => {
    const target = queue(conn, F(), { ...Q, mixed: false, conflict: false }).reviews[0]!;
    const before = summary(conn, F());
    verify(conn, user, target.id, "unreadable");
    const after = summary(conn, F());
    expect(after.reviews).toBe(before.reviews);
    expect(after.sentiment.neutral + after.sentiment.positive + after.sentiment.negative).toBe(
      before.sentiment.neutral + before.sentiment.positive + before.sentiment.negative - 1,
    );
    expect(conn.prepare("SELECT unclear FROM reviews WHERE id = ?").pluck().get(target.id)).toBe(1);
    expect(() => verify(conn, user, target.id + 100000, "positive")).toThrow(/not found/);
    expect(() => verify(conn, user, target.id, "maybe")).toThrow(/Choose/);
  });
});

describe("queue parameters", () => {
  it("do not collide with global filter names", async () => {
    const { FILTER_KEYS } = await import("@/lib/query/keys");
    for (const k of ["threshold", "mixed", "disagree", "sort", "limit", "offset"]) expect(FILTER_KEYS as readonly string[]).not.toContain(k);
  });
});
