import type Database from "better-sqlite3";
import { appendAudit } from "@/lib/audit";
import { detectLanguage } from "@/lib/nlp/language";
import { RecordRedactor } from "@/lib/redact/redact";
import { prepareVaultInsert } from "@/lib/redact/vault";
import type { PiiKind } from "@/lib/redact/rules";
import { cleanRow, type CleanRow } from "./clean";
import { validateHeader, type Column, type ColumnIndex } from "./columns";
import { QualityAccumulator, type QualityReport } from "./quality";
import { readSource, type SourceKind } from "./readers";

/**
 * Ingest pipeline: stream rows → clean/validate → redact (vault originals) → store.
 * Runs in batches inside transactions and yields to the event loop between batches,
 * so the server stays responsive during a 75k-row import.
 */
export class IngestError extends Error {}
export class IngestCancelled extends Error {}

export interface IngestInput {
  jobId: number;
  path: string;
  kind: SourceKind;
  vaultKey: Buffer;
  userId: number | null;
  role: string | null;
}

const BATCH = 500;
const tick = () => new Promise<void>((r) => setImmediate(r));

export async function runIngest(conn: Database.Database, input: IngestInput): Promise<QualityReport> {
  const { jobId } = input;
  const setJob = conn.prepare(
    "UPDATE ingest_jobs SET status = ?, stage = ?, progress = ?, processed_rows = ? WHERE id = ?",
  );
  const isCancelled = conn.prepare("SELECT cancel_requested FROM ingest_jobs WHERE id = ?").pluck();
  const dupInDb = conn
    .prepare("SELECT 1 FROM reviews WHERE retailer_review_id = ? AND ingest_id <> ? AND is_duplicate = 0 LIMIT 1")
    .pluck();
  const insertReview = conn.prepare(`INSERT INTO reviews (
      ingest_id, retailer_name, market, site, product_name, category, subcategory, brand,
      retailer_product_code, upc, manufacturer, product_url, product_rating, number_of_reviews,
      internal_review_id, retailer_review_id, review_date_iso, review_rating, review_title, review_text,
      parent_or_child, review_url, review_type, verified_purchase, helpful_review_count,
      customer_image_count, is_duplicate, language, redaction_count)
    VALUES (@ingest_id, @retailerName, @market, @site, @productName, @category, @subcategory, @brand,
      @retailerProductCode, @upc, @manufacturer, @productUrl, @productRating, @numberOfReviews,
      @internalReviewId, @retailerReviewId, @reviewDateISO, @reviewRating, @reviewTitle, @reviewText,
      @parentOrChild, @reviewUrl, @reviewType, @verifiedPurchase, @helpfulReviewCount,
      @customerImageCount, @isDuplicate, @language, @redactionCount)`);
  const vaultInsert = prepareVaultInsert(conn);

  const quality = new QualityAccumulator();
  const seen = new Set<string>();
  let fraction = 0;
  let processed = 0;
  let index: ColumnIndex | null = null;
  let done = false; // the data sheet has been fully read; ignore later sheets (e.g. PointerStorage)
  let firstMissing: Column[] | null = null;
  let batch: string[][] = [];

  const storeBatch = conn.transaction((rows: string[][], idx: ColumnIndex) => {
    for (const cells of rows) {
      const { row, issues } = cleanRow(cells, idx);
      const id = row.retailerReviewId;
      const duplicate = id !== null && (seen.has(id) || dupInDb.get(id, jobId) !== undefined);
      if (id !== null) seen.add(id);
      const language = detectLanguage(row.reviewText);

      const redactor = new RecordRedactor([row.brand ?? "", row.retailerName ?? ""]);
      const redacted: CleanRow = {
        ...row,
        reviewTitle: redactor.redact("reviewTitle", row.reviewTitle),
        reviewText: redactor.redact("reviewText", row.reviewText),
      };
      const imageCount = redactor.images(row.reviewCustomerImages);
      const textItems = redactor.items.filter((i) => i.kind !== "IMAGE");

      const info = insertReview.run({
        ...redacted,
        ingest_id: jobId,
        customerImageCount: imageCount,
        isDuplicate: duplicate ? 1 : 0,
        language,
        redactionCount: textItems.length,
      });
      vaultInsert(input.vaultKey, Number(info.lastInsertRowid), redactor.items);
      quality.add(row, issues, { duplicate, language, redactions: textItems.map((i) => i.kind as PiiKind) });
      processed++;
    }
  });

  async function flush() {
    if (!batch.length || !index) return;
    storeBatch(batch, index);
    batch = [];
    setJob.run("running", "processing", fraction, processed, jobId);
    if (isCancelled.get(jobId) === 1) throw new IngestCancelled();
    await tick();
  }

  setJob.run("running", "reading", 0, 0, jobId);
  try {
    for await (const ev of readSource(input.path, input.kind, { onProgress: (f) => (fraction = f) })) {
      if (ev.type === "header") {
        await flush();
        if (index) done = true;
        if (done) continue;
        const v = validateHeader(ev.cells);
        if (v.index) index = v.index;
        else firstMissing ??= v.missing;
        continue;
      }
      if (!index || done) continue;
      if (ev.cells.every((c) => !c || !c.trim())) continue; // blank line
      batch.push(ev.cells);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    if (!index) {
      throw new IngestError(
        `The file is missing required columns: ${(firstMissing ?? []).join(", ") || "no header row found"}.`,
      );
    }
    if (processed === 0) throw new IngestError("The file has a valid header but no data rows.");
  } catch (err) {
    // Remove partial rows; vault entries cascade.
    conn.prepare("DELETE FROM reviews WHERE ingest_id = ?").run(jobId);
    throw err;
  }

  const report = quality.report();
  conn
    .prepare(
      `UPDATE ingest_jobs SET status = 'done', stage = 'done', progress = 1, processed_rows = ?, total_rows = ?,
         quality_report = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
    .run(processed, processed, JSON.stringify(report), jobId);
  appendAudit(conn, {
    userId: input.userId, role: input.role, action: "redaction_run", entityType: "ingest", entityId: String(jobId),
    details: { recordsWithRedactions: report.recordsWithRedactions, byKind: report.redactions },
  });
  return report;
}
