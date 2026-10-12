/**
 * Command-line import for IT: same pipeline as the Data tab, without a browser.
 *   npm run import -- "path/to/file.csv.gz"
 * Stop `npm run dev` first: a starting server marks unfinished imports as failed.
 * The source file is read in place and never copied or deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { piiVaultKey } from "@/lib/env";
import { runIngest } from "@/lib/ingest/pipeline";
import { detectKind } from "@/lib/ingest/readers";

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error("Usage: npm run import -- <file.xlsx|.csv|.csv.gz>");
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  const kind = detectKind(head);
  if (!kind) throw new Error("Unrecognised file type. Use .xlsx, .csv or .csv.gz.");

  const conn = openDb();
  const name = path.basename(file);
  const jobId = Number(
    conn
      .prepare("INSERT INTO ingest_jobs (filename, status, stage, source_kind, file_bytes, started_at) VALUES (?, 'running', 'reading', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      .run(name, kind, fs.statSync(file).size).lastInsertRowid,
  );
  appendAudit(conn, { role: "system", action: "ingest_started", entityType: "ingest", entityId: String(jobId), details: { kind, via: "cli", filename: name } });
  const started = Date.now();
  let lastPct = -1;
  const timer = setInterval(() => {
    const p = conn.prepare("SELECT progress, processed_rows FROM ingest_jobs WHERE id = ?").get(jobId) as { progress: number; processed_rows: number };
    const pct = Math.floor(p.progress * 100);
    if (pct !== lastPct) process.stdout.write(`\r${pct}%  ${p.processed_rows.toLocaleString()} rows`);
    lastPct = pct;
  }, 500);
  try {
    const report = await runIngest(conn, { jobId, path: file, kind, vaultKey: piiVaultKey(), userId: null, role: "system" });
    const ms = Date.now() - started;
    appendAudit(conn, { role: "system", action: "ingest_completed", entityType: "ingest", entityId: String(jobId), details: { rows: report.totalRows, durationMs: ms, qualityScore: report.score, via: "cli" } });
    console.log(`\nImported ${report.totalRows.toLocaleString()} rows in ${(ms / 1000).toFixed(1)} s. Quality score ${report.score}/100. ${report.recordsWithRedactions} records redacted.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    conn.prepare("UPDATE ingest_jobs SET status = 'failed', stage = 'failed', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(message, jobId);
    appendAudit(conn, { role: "system", action: "ingest_failed", entityType: "ingest", entityId: String(jobId), details: { error: message, via: "cli" }, status: "failed" });
    throw err;
  } finally {
    clearInterval(timer);
    conn.close();
  }
}

main().catch((err) => {
  console.error(`\n[import] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
