import type Database from "better-sqlite3";
import type { ReviewAnalysis } from "./analyze";

/**
 * Writes rule-based NLP output for one review. Replaces earlier rule tags but keeps
 * AI and human tags; a human tag on the same theme wins over the rule. Sentiment that a
 * person verified (verified_at set) is never overwritten.
 */
export function prepareAnalysisWriter(conn: Database.Database) {
  const update = conn.prepare(
    `UPDATE reviews SET sentiment = ?, sentiment_score = ?, confidence = ?, rating_text_conflict = ?,
       tag_source = ?, trust_weight = ?, nlp_version = ? WHERE id = ? AND verified_at IS NULL`,
  );
  const updateVerified = conn.prepare("UPDATE reviews SET trust_weight = ?, nlp_version = ? WHERE id = ? AND verified_at IS NOT NULL");
  const clear = conn.prepare("DELETE FROM review_themes WHERE review_id = ? AND source = 'rule'");
  const insert = conn.prepare(
    "INSERT OR IGNORE INTO review_themes (review_id, theme, vector, confidence, source, sentiment) VALUES (?, ?, ?, ?, 'rule', ?)",
  );
  return (reviewId: number, a: ReviewAnalysis, trust: number, version: string, fresh = false) => {
    if (update.run(a.sentiment, a.sentimentScore, a.confidence, a.ratingTextConflict, a.sentiment ? "rule" : null, trust, version, reviewId).changes === 0) {
      updateVerified.run(trust, version, reviewId);
    }
    if (!fresh) clear.run(reviewId);
    for (const t of a.themes) insert.run(reviewId, t.theme, t.vector, t.confidence, t.sentiment);
  };
}
