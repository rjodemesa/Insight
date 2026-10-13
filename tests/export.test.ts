import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { runIngest } from "@/lib/ingest/pipeline";
import { exportWorkbook, type ExportKind } from "@/lib/export/excel";
import { parseFilters } from "@/lib/query/filters";
import { retailers, summary, themes, trend } from "@/lib/insights/queries";
import { hoursSaved, keyFindings } from "@/lib/insights/derive";
import { operations } from "@/lib/insights/operations";
import { makeFixture } from "../scripts/make-fixture";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "insight-export-"));
const fixture = path.join(tmp, "sample_reviews.xlsx");
let conn: Database.Database;
const F = (qs = "") => parseFilters(new URLSearchParams(qs));

beforeAll(async () => {
  await makeFixture(fixture);
  conn = openDb(":memory:");
  const jobId = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('f', 'queued')").run().lastInsertRowid);
  await runIngest(conn, { jobId, path: fixture, kind: "xlsx", vaultKey: crypto.randomBytes(32), userId: null, role: null });
});

async function exportToBook(kind: ExportKind, qs = "") {
  const { stream, done } = exportWorkbook(conn, kind, F(qs), "analyst@example.com");
  const chunks: Buffer[] = [];
  const ended = new Promise((r) => stream.on("end", r));
  stream.on("data", (c: Buffer) => chunks.push(c));
  const [rows] = await Promise.all([done, ended]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
  return { wb, rows };
}

const allText = (wb: ExcelJS.Workbook) => {
  const out: string[] = [];
  wb.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? "")))));
  return out.join("\n");
};

describe("Excel export", () => {
  it("exports every filtered review with provenance headers and an About sheet", async () => {
    const { wb, rows } = await exportToBook("reviews");
    expect(rows).toBe(summary(conn, F()).reviews);
    const sheet = wb.getWorksheet("Reviews")!;
    expect(sheet.rowCount).toBe(rows + 1);
    expect(String(sheet.getRow(1).getCell(1).value)).toBe("Review ID [OBSERVED]");
    const about = wb.getWorksheet("About this export")!;
    const aboutText = allText(wb);
    expect(about).toBeDefined();
    expect(aboutText).toContain("analyst@example.com");
    expect(aboutText).toContain("redacted");
  });

  it("never exports the personal data that redaction removed", async () => {
    const text = allText((await exportToBook("reviews")).wb);
    expect(text).toContain("[PHONE_");
    for (const pii of ["0917 123 4567", "juan.dc@example.com", "Maria Santos", "@shopper_ph", "123456789012345"]) expect(text).not.toContain(pii);
  });

  it("applies filters and records them", async () => {
    const neg = summary(conn, F("sentiment=negative")).reviews;
    const { wb, rows } = await exportToBook("reviews", "sentiment=negative");
    expect(rows).toBe(neg);
    expect(allText(wb)).toContain('"sentiment":["negative"]');
  });

  it("exports the aggregate tables", async () => {
    for (const kind of ["products", "brands", "retailers", "themes", "trend"] as const) {
      const { wb, rows } = await exportToBook(kind);
      expect(rows, kind).toBeGreaterThan(0);
      expect(wb.worksheets.map((w) => w.name)).toContain("About this export");
    }
  });
});

describe("key findings and estimates", () => {
  it("states sample sizes and links each finding to its reviews", () => {
    const f = keyFindings({ summary: summary(conn, F()), themes: themes(conn, F()), retailers: retailers(conn, F()), trend: trend(conn, F(), "month") });
    expect(f[0]!.kind).toBe("overview");
    expect(f[0]!.text).toMatch(/^198 reviews/);
    const issue = f.find((x) => x.kind === "issue");
    expect(issue?.drill).toMatchObject({ themeSentiment: "negative" });
    for (const x of f.filter((x) => x.drill)) expect(() => parseFilters(new URLSearchParams(x.drill))).not.toThrow();
  });

  it("says so when nothing matches", () => {
    const none = F("brand=__none__");
    expect(keyFindings({ summary: summary(conn, none), themes: themes(conn, none), retailers: retailers(conn, none) })).toEqual([
      { kind: "data", text: "No reviews match the current filters." },
    ]);
  });

  it("computes hours saved from the editable assumption, never below zero", () => {
    expect(hoursSaved(600, 1.5, 0)).toBe(15);
    expect(hoursSaved(600, 1.5, 3_600_000)).toBe(14);
    expect(hoursSaved(1, 0.1, 3_600_000)).toBe(0);
  });

  it("reports the latest import's quality score and timing", () => {
    conn.prepare("UPDATE ingest_jobs SET started_at = '2024-01-01T00:00:00.000Z', finished_at = '2024-01-01T00:00:05.000Z'").run();
    const ops = operations(conn);
    expect(ops.latestImport?.qualityScore).toBeGreaterThan(0);
    expect(ops.latestImport?.durationMs).toBe(5000);
    expect(ops.provenance.hoursSaved).toBe("ESTIMATED");
  });
});
