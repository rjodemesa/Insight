import type Database from "better-sqlite3";
import { QUALITY_SCORE_FORMULA } from "@/lib/ingest/quality";
import { ESTIMATE_SETTINGS, getEstimates } from "@/lib/settings";
import type { Provenance } from "@/lib/theme";

/**
 * Pipeline facts for the dashboard: data-quality score and processing time of the latest
 * import, and the editable assumption behind the analyst-hours estimate. Not filtered:
 * these describe the data load, not a slice of reviews.
 */
export function operations(conn: Database.Database) {
  const latest = conn
    .prepare(
      `SELECT id, filename, processed_rows AS rows, started_at, finished_at, quality_report
       FROM ingest_jobs WHERE status = 'done' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { id: number; filename: string; rows: number; started_at: string | null; finished_at: string | null; quality_report: string | null } | undefined;
  let qualityScore: number | null = null;
  try {
    qualityScore = latest?.quality_report ? (JSON.parse(latest.quality_report) as { score?: number }).score ?? null : null;
  } catch {
    qualityScore = null;
  }
  const durationMs = latest?.started_at && latest.finished_at ? Date.parse(latest.finished_at) - Date.parse(latest.started_at) : null;
  return {
    latestImport: latest
      ? { id: latest.id, filename: latest.filename, rows: latest.rows, finishedAt: latest.finished_at, durationMs, qualityScore }
      : null,
    estimates: getEstimates(conn),
    estimateLabels: Object.fromEntries(Object.entries(ESTIMATE_SETTINGS).map(([k, s]) => [k, { label: s.label, min: s.min, max: s.max }])),
    provenance: { qualityScore: "DERIVED", durationMs: "OBSERVED", hoursSaved: "ESTIMATED" } satisfies Record<string, Provenance>,
    method: {
      qualityScore: QUALITY_SCORE_FORMULA,
      hoursSaved: "reviews in view × minutes per review ÷ 60, minus the time the import took. An assumption, not a measurement.",
    },
  };
}
