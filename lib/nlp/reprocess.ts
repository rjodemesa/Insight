import type Database from "better-sqlite3";
import { mapProducts, type MappingStats } from "@/lib/mapping/products";
import { trustWeight } from "@/lib/score/trust";
import { analyzeReview, nlpVersion } from "./analyze";
import { prepareAnalysisWriter } from "./store";

/**
 * Re-runs tagging on stored (redacted) reviews, then maps any reviews without a product.
 * Use after editing config/taxonomy.json or a lexicon, or to tag Phase 1 imports.
 * By default only reviews tagged with an older version are redone; `all` redoes every one.
 */
export interface ReprocessStats {
  reviews: number;
  version: string;
  mapping: MappingStats;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

export async function reprocess(
  conn: Database.Database,
  opts: { all?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<ReprocessStats> {
  const version = nlpVersion();
  const scope = opts.all ? "1=1" : "(nlp_version IS NULL OR nlp_version <> @version)";
  const total = conn.prepare(`SELECT COUNT(*) FROM reviews WHERE ${scope}`).pluck().get({ version }) as number;
  const page = conn.prepare(
    `SELECT id, review_title, review_text, review_rating, is_duplicate, verified_purchase, helpful_review_count
     FROM reviews WHERE ${scope} AND id > @after ORDER BY id LIMIT 1000`,
  );
  const write = prepareAnalysisWriter(conn);
  type Row = { id: number; review_title: string | null; review_text: string | null; review_rating: number | null; is_duplicate: number; verified_purchase: number | null; helpful_review_count: number | null };
  const apply = conn.transaction((rows: Row[]) => {
    for (const r of rows) {
      const a = analyzeReview({ title: r.review_title, text: r.review_text, rating: r.review_rating });
      const trust = trustWeight({
        isDuplicate: r.is_duplicate === 1, verifiedPurchase: r.verified_purchase,
        textLength: r.review_text?.length ?? 0, helpfulCount: r.helpful_review_count,
      });
      write(r.id, a, trust, version);
    }
  });
  let done = 0;
  for (let after = 0; ; ) {
    const rows = page.all({ version, after }) as Row[];
    if (rows.length === 0) break;
    apply(rows);
    done += rows.length;
    after = rows[rows.length - 1]!.id;
    opts.onProgress?.(done, total);
    await tick();
  }
  const mapping = await mapProducts(conn, null);
  return { reviews: done, version, mapping };
}
