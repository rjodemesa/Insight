import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { REQUIRED_COLUMNS } from "@/lib/ingest/columns";
import { IngestCancelled, IngestError, runIngest } from "@/lib/ingest/pipeline";
import type { SourceKind } from "@/lib/ingest/readers";
import { revealRecord } from "@/lib/redact/vault";
import { makeFixture } from "../scripts/make-fixture";

const key = crypto.randomBytes(32);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "insight-test-"));
const fixture = path.join(tmp, "sample_reviews.xlsx");
let fixtureRows: Record<string, string>[];

beforeAll(async () => {
  fixtureRows = (await makeFixture(fixture)).rows;
});

function newJob(conn: Database.Database, name = "f") {
  return Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES (?, 'queued')").run(name).lastInsertRowid);
}
const ingest = (conn: Database.Database, p: string, kind: SourceKind) =>
  runIngest(conn, { jobId: newJob(conn), path: p, kind, vaultKey: key, userId: null, role: null });

const csvEscape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

describe("ingest pipeline", () => {
  it("imports the 200-row fixture, flags problems and ignores PointerStorage", async () => {
    const conn = openDb(":memory:");
    const report = await ingest(conn, fixture, "xlsx");
    expect(report.totalRows).toBe(200);
    expect(report.duplicates).toBe(2);
    expect(report.invalidRatings).toBe(1);
    expect(report.invalidDates).toBe(1);
    expect(report.emptyText).toBeGreaterThan(0);
    expect(report.redactions.PHONE).toBeGreaterThan(0);
    expect(report.languages.taglish ?? 0).toBeGreaterThan(0);
    expect(verifyAuditChain(conn).ok).toBe(true);

    // Nothing stored in analysis tables contains the fake PII.
    const leaked = conn
      .prepare("SELECT COUNT(*) FROM reviews WHERE review_text LIKE '%0917%' OR review_text LIKE '%@example.com%' OR review_text LIKE '%Maria%'")
      .pluck().get();
    expect(leaked).toBe(0);
  });

  it("round-trips every redacted record back to the original text", async () => {
    const conn = openDb(":memory:");
    await ingest(conn, fixture, "xlsx");
    const ids = conn.prepare("SELECT id, internal_review_id FROM reviews WHERE redaction_count > 0").all() as { id: number; internal_review_id: string }[];
    expect(ids.length).toBeGreaterThan(0);
    for (const { id, internal_review_id } of ids) {
      const original = fixtureRows.find((r) => r.internalReviewId === internal_review_id)!;
      expect(revealRecord(conn, key, id)!.reviewText).toBe(original.reviewText);
    }
  });

  it("rejects a file with missing columns and lists them", async () => {
    const conn = openDb(":memory:");
    const p = path.join(tmp, "bad.csv");
    fs.writeFileSync(p, "retailerName,brand\nLazada,X\n");
    await expect(ingest(conn, p, "csv")).rejects.toThrow(IngestError);
    await expect(ingest(conn, p, "csv")).rejects.toThrow(/reviewText/);
  });

  it("cancels cleanly and keeps no rows", async () => {
    const conn = openDb(":memory:");
    const p = path.join(tmp, "cancel.csv");
    fs.writeFileSync(p, synthCsv(3000));
    const jobId = newJob(conn);
    conn.prepare("UPDATE ingest_jobs SET cancel_requested = 1 WHERE id = ?").run(jobId);
    await expect(runIngest(conn, { jobId, path: p, kind: "csv", vaultKey: key, userId: null, role: null })).rejects.toThrow(IngestCancelled);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews").pluck().get()).toBe(0);
  });

  it("imports 75,000 rows from .csv.gz with progress and without blocking the event loop", async () => {
    const conn = openDb(path.join(tmp, "big.db"));
    const p = path.join(tmp, "big.csv.gz");
    fs.writeFileSync(p, zlib.gzipSync(synthCsv(75_000)));
    const jobId = newJob(conn, "big");
    const progress: number[] = [];
    const poll = setInterval(() => {
      progress.push(conn.prepare("SELECT progress FROM ingest_jobs WHERE id = ?").pluck().get(jobId) as number);
    }, 100);
    // Track the longest gap between timer ticks: a frozen event loop shows up as a big gap.
    let last = Date.now();
    let maxGap = 0;
    const beat = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const started = Date.now();
    const report = await runIngest(conn, { jobId, path: p, kind: "csv.gz", vaultKey: key, userId: null, role: null });
    clearInterval(poll);
    clearInterval(beat);
    expect(report.totalRows).toBe(75_000);
    expect(conn.prepare("SELECT COUNT(*) FROM reviews").pluck().get()).toBe(75_000);
    expect(new Set(progress.filter((x) => x > 0 && x < 1)).size).toBeGreaterThan(1);
    expect(maxGap).toBeLessThan(1000);
    console.log(`75k rows in ${((Date.now() - started) / 1000).toFixed(1)} s, longest event-loop gap ${maxGap} ms`);
    conn.close();
  }, 300_000);
});

function synthCsv(n: number): string {
  const texts = ["Sobrang bango!", "Leak sa bote, call 09171234567", "Very good, legit seller", "", "Ako si Juan, salamat"];
  const lines = [REQUIRED_COLUMNS.join(",")];
  for (let i = 0; i < n; i++) {
    const r: Record<string, string> = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, ""]));
    Object.assign(r, {
      retailerName: "Lazada", market: "PH", productName: `Product ${i % 50}`, category: "Fabric Care",
      subcategory: "Laundry", brand: `Brand ${i % 7}`, retailerReviewId: `R${i}`, internalReviewId: `I${i}`,
      reviewDateISO: new Date(Date.UTC(2023, 0, 1) + (i % 500) * 86_400_000).toISOString(),
      reviewRating: String((i % 5) + 1), reviewText: texts[i % texts.length]!, verifiedPurchase: "TRUE",
    });
    lines.push(REQUIRED_COLUMNS.map((c) => csvEscape(r[c]!)).join(","));
  }
  return lines.join("\n") + "\n";
}
