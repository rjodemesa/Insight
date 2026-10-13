import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import type Database from "better-sqlite3";
import { describeFilters, whereClause, type Filters } from "@/lib/query/filters";
import { brands, products, retailers, SCORE_METHOD, themes, trend } from "@/lib/insights/queries";
import { PROVENANCE, type Provenance } from "@/lib/theme";

/**
 * Excel export of the current filtered view. Review text is the redacted text that is
 * stored; vault contents are never read here, whatever the user's role. Every file has
 * an "About this export" sheet with the filters, who exported it, and what each
 * column's provenance label means.
 */
export const EXPORT_KINDS = ["reviews", "products", "brands", "retailers", "themes", "trend"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const MAX_EXPORT_ROWS = 100_000;

interface Column {
  header: string;
  key: string;
  width?: number;
  provenance: Provenance;
}

const REVIEW_COLUMNS: Column[] = [
  { header: "Review ID", key: "id", provenance: "OBSERVED" },
  { header: "Internal review ID", key: "internal_review_id", width: 18, provenance: "OBSERVED" },
  { header: "Date", key: "date", width: 12, provenance: "OBSERVED" },
  { header: "Retailer", key: "retailer", width: 14, provenance: "OBSERVED" },
  { header: "Brand", key: "brand", width: 16, provenance: "OBSERVED" },
  { header: "Category", key: "category", width: 16, provenance: "OBSERVED" },
  { header: "Subcategory", key: "subcategory", width: 16, provenance: "OBSERVED" },
  { header: "Product (canonical)", key: "product", width: 36, provenance: "DERIVED" },
  { header: "Listing name", key: "listing", width: 36, provenance: "OBSERVED" },
  { header: "Rating", key: "rating", provenance: "OBSERVED" },
  { header: "Title (redacted)", key: "title", width: 30, provenance: "OBSERVED" },
  { header: "Text (redacted)", key: "text", width: 60, provenance: "OBSERVED" },
  { header: "Language", key: "language", provenance: "DERIVED" },
  { header: "Sentiment", key: "sentiment", provenance: "DERIVED" },
  { header: "Sentiment score", key: "sentiment_score", provenance: "DERIVED" },
  { header: "Themes", key: "themes", width: 36, provenance: "DERIVED" },
  { header: "Rating/text conflict", key: "conflict", provenance: "DERIVED" },
  { header: "Verified purchase", key: "verified", provenance: "OBSERVED" },
  { header: "Helpful votes", key: "helpful", provenance: "OBSERVED" },
  { header: "Trust weight", key: "trust", provenance: "DERIVED" },
  { header: "Redactions", key: "redactions", provenance: "DERIVED" },
];

const GROUP_COLUMNS = (first: Column[]): Column[] => [
  ...first,
  { header: "Reviews", key: "reviews", provenance: "OBSERVED" },
  { header: "Average rating", key: "averageRating", provenance: "OBSERVED" },
  { header: "Positive share", key: "positiveShare", provenance: "DERIVED" },
  { header: "Negative share", key: "negativeShare", provenance: "DERIVED" },
  { header: "Verified share", key: "verifiedShare", provenance: "OBSERVED" },
  { header: "Intelligence Score", key: "score", provenance: "DERIVED" },
  { header: "Score reliability", key: "reliability", provenance: "DERIVED" },
];

type Row = Record<string, string | number | null>;

/** Table rows for the small (aggregate) exports. */
function aggregateRows(conn: Database.Database, kind: Exclude<ExportKind, "reviews">, f: Filters): { columns: Column[]; rows: Row[]; method: string } {
  const scored = <T extends { intelligenceScore: { score: number | null; reliability: string } }>(r: T) => ({ ...r, score: r.intelligenceScore.score, reliability: r.intelligenceScore.reliability });
  const pick = (list: Record<string, unknown>[], cols: Column[]) => list.map((r) => Object.fromEntries(cols.map((c) => [c.key, (r[c.key] ?? null) as string | number | null])));
  switch (kind) {
    case "products": {
      const cols = GROUP_COLUMNS([
        { header: "Product ID", key: "id", provenance: "DERIVED" }, { header: "Product", key: "name", width: 40, provenance: "DERIVED" },
        { header: "Brand", key: "brand", width: 16, provenance: "OBSERVED" }, { header: "Category", key: "category", width: 16, provenance: "OBSERVED" },
        { header: "Size", key: "size", provenance: "DERIVED" },
      ]);
      return { columns: cols, rows: pick(products(conn, f, "score", MAX_EXPORT_ROWS).products.map(scored), cols), method: SCORE_METHOD.formula };
    }
    case "brands": {
      const cols = GROUP_COLUMNS([{ header: "Brand", key: "brand", width: 20, provenance: "OBSERVED" }, { header: "Products", key: "products", provenance: "DERIVED" }]);
      return { columns: cols, rows: pick(brands(conn, f).brands.map(scored), cols), method: SCORE_METHOD.formula };
    }
    case "retailers": {
      const cols = GROUP_COLUMNS([{ header: "Retailer", key: "retailer", width: 20, provenance: "OBSERVED" }]);
      return { columns: cols, rows: pick(retailers(conn, f).retailers.map(scored), cols), method: SCORE_METHOD.formula };
    }
    case "themes": {
      const t = themes(conn, f);
      const cols: Column[] = [
        { header: "Theme", key: "label", width: 28, provenance: "DERIVED" }, { header: "Vector", key: "vector", width: 16, provenance: "DERIVED" },
        { header: "Reviews", key: "reviews", provenance: "DERIVED" }, { header: "Share of reviews with text", key: "share", provenance: "DERIVED" },
        { header: "Positive", key: "positive", provenance: "DERIVED" }, { header: "Neutral", key: "neutral", provenance: "DERIVED" },
        { header: "Negative", key: "negative", provenance: "DERIVED" }, { header: "Negative share", key: "negativeShare", provenance: "DERIVED" },
        { header: "Negative change (pts)", key: "negChange", provenance: "DERIVED" }, { header: "Change significant", key: "negSignificant", provenance: "DERIVED" },
      ];
      const rows = t.themes.map((x) => ({ ...x, negChange: x.negativeChange.diffPts, negSignificant: x.negativeChange.significant ? "yes" : "no" }));
      return { columns: cols, rows: pick(rows, cols), method: t.method };
    }
    case "trend": {
      const t = trend(conn, f, "month");
      const cols: Column[] = [
        { header: "Month", key: "period", provenance: "OBSERVED" }, { header: "Reviews", key: "n", provenance: "OBSERVED" },
        { header: "Average rating", key: "averageRating", provenance: "OBSERVED" }, { header: "Positive", key: "positive", provenance: "DERIVED" },
        { header: "Neutral", key: "neutral", provenance: "DERIVED" }, { header: "Negative", key: "negative", provenance: "DERIVED" },
        { header: "Negative share", key: "negativeShare", provenance: "DERIVED" }, { header: "Weighted sentiment", key: "weightedSentiment", provenance: "DERIVED" },
      ];
      return { columns: cols, rows: pick(t.series, cols), method: t.method };
    }
  }
}

const CHUNK = 1000;
const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Reviews in chunks, newest import first (by id). Each chunk is a complete query, so the
 * shared connection is free for other requests while the file streams out.
 */
async function* reviewRows(conn: Database.Database, f: Filters): AsyncGenerator<Row> {
  const w = whereClause(f);
  const stmt = conn.prepare(
    `SELECT r.id, r.internal_review_id, substr(r.review_date_iso, 1, 10) AS date, r.retailer_name AS retailer, r.brand,
       r.category, r.subcategory, p.canonical_name AS product, r.product_name AS listing, r.review_rating AS rating,
       r.review_title AS title, r.review_text AS text, r.language, r.sentiment, r.sentiment_score,
       (SELECT GROUP_CONCAT(t.theme || ':' || COALESCE(t.sentiment, ''), '; ') FROM review_themes t WHERE t.review_id = r.id) AS themes,
       CASE r.rating_text_conflict WHEN 1 THEN 'yes' ELSE '' END AS conflict,
       CASE r.verified_purchase WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END AS verified,
       r.helpful_review_count AS helpful, r.trust_weight AS trust, r.redaction_count AS redactions
     FROM reviews r LEFT JOIN products p ON p.id = r.product_id
     WHERE ${w.sql} AND r.id < ? ORDER BY r.id DESC LIMIT ?`,
  );
  let before = Number.MAX_SAFE_INTEGER;
  for (let sent = 0; sent < MAX_EXPORT_ROWS; ) {
    const rows = stmt.all(...w.params, before, Math.min(CHUNK, MAX_EXPORT_ROWS - sent)) as Row[];
    if (!rows.length) return;
    yield* rows;
    sent += rows.length;
    before = rows[rows.length - 1]!.id as number;
    await tick();
  }
}

function aboutSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, meta: { kind: ExportKind; f: Filters; user: string; rows: number; columns: Column[]; method: string }) {
  const s = wb.addWorksheet("About this export");
  s.columns = [{ width: 28 }, { width: 100 }];
  const manila = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  const add = (a: string, b: string | number = "") => s.addRow([a, b]).commit();
  add("Export", meta.kind);
  add("Exported (Manila time)", manila);
  add("Exported by", meta.user);
  add("Rows", meta.rows);
  if (meta.kind === "reviews" && meta.rows >= MAX_EXPORT_ROWS) add("Note", `Stopped at ${MAX_EXPORT_ROWS.toLocaleString()} rows. Narrow the filters to export the rest.`);
  add("Filters", JSON.stringify(describeFilters(meta.f)) === "{}" ? "none (all reviews, duplicates excluded)" : JSON.stringify(describeFilters(meta.f)));
  add("Privacy", "Text is redacted: personal data is replaced by tokens such as [PHONE_001]. Originals are not exported.");
  add("Method", meta.method);
  add("");
  add("Column", "Provenance");
  for (const c of meta.columns) add(c.header, `${c.provenance}: ${PROVENANCE[c.provenance].definition}`);
}

/** Streams the workbook. Resolves with the row count once the file is fully written. */
export function exportWorkbook(conn: Database.Database, kind: ExportKind, f: Filters, user: string): { stream: PassThrough; done: Promise<number> } {
  const stream = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  const done = (async () => {
    const data = kind === "reviews" ? null : aggregateRows(conn, kind, f);
    const columns = data?.columns ?? REVIEW_COLUMNS;
    const sheet = wb.addWorksheet(kind[0]!.toUpperCase() + kind.slice(1));
    sheet.columns = columns.map((c) => ({ header: `${c.header} [${c.provenance}]`, key: c.key, width: c.width ?? 14 }));
    sheet.getRow(1).font = { bold: true };
    let n = 0;
    for await (const row of data?.rows ?? reviewRows(conn, f)) {
      sheet.addRow(row).commit();
      n++;
    }
    sheet.commit();
    aboutSheet(wb, { kind, f, user, rows: n, columns, method: data?.method ?? "Rows are individual reviews, most recently imported first. Duplicates are excluded unless the filters include them." });
    await wb.commit();
    return n;
  })();
  done.catch((err) => stream.destroy(err as Error));
  return { stream, done };
}
