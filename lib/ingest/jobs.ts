import "server-only";
import fs from "node:fs";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { piiVaultKey } from "@/lib/env";
import { log } from "@/lib/log";
import { bumpDataVersion } from "@/lib/insights/cache";
import { IngestCancelled, IngestError, runIngest } from "./pipeline";
import type { SourceKind } from "./readers";

/**
 * In-process job queue (single server instance). Jobs run one at a time; state lives
 * in SQLite so the UI can poll it. Uploaded files are deleted once processed.
 */
interface QueuedJob {
  jobId: number;
  path: string;
  kind: SourceKind;
  userId: number;
  role: string;
}

const g = globalThis as unknown as { __ingestQueue?: { queue: QueuedJob[]; running: boolean; recovered: boolean } };
const state = (g.__ingestQueue ??= { queue: [], running: false, recovered: false });

/** Jobs left "running" by a server restart can never finish; mark them failed once per process. */
function recoverStaleJobs() {
  if (state.recovered) return;
  state.recovered = true;
  const conn = db();
  const stale = conn.prepare("SELECT id FROM ingest_jobs WHERE status IN ('queued','running')").pluck().all() as number[];
  for (const id of stale) {
    conn.prepare("DELETE FROM reviews WHERE ingest_id = ?").run(id);
    conn
      .prepare("UPDATE ingest_jobs SET status = 'failed', stage = 'failed', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run("The server restarted before this import finished. Upload the file again.", id);
  }
}

export function enqueueIngest(job: QueuedJob) {
  recoverStaleJobs();
  state.queue.push(job);
  void drain();
}

export { recoverStaleJobs };

async function drain() {
  if (state.running) return;
  state.running = true;
  try {
    for (let job = state.queue.shift(); job; job = state.queue.shift()) await runOne(job);
  } finally {
    state.running = false;
  }
}

async function runOne(job: QueuedJob) {
  const conn = db();
  const finish = (status: "failed" | "cancelled", error: string | null) =>
    conn
      .prepare("UPDATE ingest_jobs SET status = ?, stage = ?, error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(status, status, error, job.jobId);
  const audit = (action: string, details: Record<string, unknown>, status = "ok") =>
    appendAudit(conn, { userId: job.userId, role: job.role, action, entityType: "ingest", entityId: String(job.jobId), details, status });

  const started = Date.now();
  conn.prepare("UPDATE ingest_jobs SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(job.jobId);
  audit("ingest_started", { kind: job.kind });
  try {
    const vaultKey = piiVaultKey(); // refuses to run without a key
    const report = await runIngest(conn, { ...job, vaultKey });
    const ms = Date.now() - started;
    audit("ingest_completed", { rows: report.totalRows, durationMs: ms, qualityScore: report.score });
    log("info", "ingest_completed", { jobId: job.jobId, rows: report.totalRows, ms });
  } catch (err) {
    if (err instanceof IngestCancelled) {
      finish("cancelled", null);
      audit("ingest_cancelled", {}, "cancelled");
    } else {
      // Only our own messages reach the UI; anything else is logged without row content.
      const message = err instanceof IngestError || (err instanceof Error && /PII_VAULT_KEY/.test(err.message))
        ? err.message
        : "The import failed unexpectedly. Check the server log.";
      finish("failed", message);
      audit("ingest_failed", { error: message }, "failed");
      log("error", "ingest_failed", { jobId: job.jobId, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    }
  } finally {
    // Even a cancelled or failed import may have written rows.
    bumpDataVersion();
    fs.rm(job.path, { force: true }, () => {});
  }
}
