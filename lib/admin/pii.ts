import type Database from "better-sqlite3";
import { decryptValue } from "@/lib/redact/vault";
import { analyzeReview, nlpVersion } from "@/lib/nlp/analyze";
import { prepareAnalysisWriter } from "@/lib/nlp/store";
import { trustWeight } from "@/lib/score/trust";

/**
 * Restore: puts chosen originals back into a review's stored text and deletes them from
 * the vault. For false positives only (a product code read as a phone number, a brand
 * read as a name): restored text becomes visible to every user, in exports and to the AI.
 * The review is re-tagged afterwards because its text changed.
 */
type Conn = Database.Database;

export class PiiError extends Error {}

const FIELD_COLUMN: Record<string, "review_title" | "review_text"> = { reviewTitle: "review_title", reviewText: "review_text" };

export function restoreTokens(conn: Conn, key: Buffer, reviewId: number, tokens: string[]) {
  const review = conn
    .prepare("SELECT id, review_title, review_text, review_rating, is_duplicate, verified_purchase, helpful_review_count FROM reviews WHERE id = ?")
    .get(reviewId) as
    | { id: number; review_title: string | null; review_text: string | null; review_rating: number | null; is_duplicate: number; verified_purchase: number | null; helpful_review_count: number | null }
    | undefined;
  if (!review) throw new PiiError("Review not found.");
  const wanted = [...new Set(tokens.filter((t) => typeof t === "string" && /^\[[A-Z]+_\d{3}\]$/.test(t)))];
  if (!wanted.length) throw new PiiError("Choose at least one token to restore.");
  const rows = conn
    .prepare(`SELECT id, field, token, kind, ciphertext, iv, auth_tag FROM pii_vault WHERE review_id = ? AND token IN (${wanted.map(() => "?").join(",")})`)
    .all(reviewId, ...wanted) as { id: number; field: string; token: string; kind: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }[];
  if (rows.length !== wanted.length) throw new PiiError("Some of those tokens are not in this review's vault.");
  if (rows.some((r) => !FIELD_COLUMN[r.field])) throw new PiiError("Only tokens in the review title or text can be restored.");

  const text = { review_title: review.review_title, review_text: review.review_text };
  for (const r of rows) {
    const value = decryptValue(key, reviewId, r.field, r.token, { iv: r.iv, ciphertext: r.ciphertext, authTag: r.auth_tag });
    const col = FIELD_COLUMN[r.field]!;
    text[col] = text[col]?.split(r.token).join(value) ?? null;
  }
  const write = prepareAnalysisWriter(conn);
  conn.transaction(() => {
    conn
      .prepare("UPDATE reviews SET review_title = ?, review_text = ?, redaction_count = MAX(0, redaction_count - ?) WHERE id = ?")
      .run(text.review_title, text.review_text, rows.length, reviewId);
    conn.prepare(`DELETE FROM pii_vault WHERE id IN (${rows.map(() => "?").join(",")})`).run(...rows.map((r) => r.id));
    const a = analyzeReview({ title: text.review_title, text: text.review_text, rating: review.review_rating });
    const trust = trustWeight({
      isDuplicate: review.is_duplicate === 1, verifiedPurchase: review.verified_purchase,
      textLength: text.review_text?.length ?? 0, helpfulCount: review.helpful_review_count,
    });
    write(reviewId, a, trust, nlpVersion());
  })();
  return { reviewId, restored: rows.map((r) => ({ token: r.token, kind: r.kind, field: r.field })) };
}

/** Reviews users flagged as having missed personal data, newest first, for the IT officer to check. */
export function redactionFlags(conn: Conn, limit = 50) {
  return conn
    .prepare(
      `SELECT f.id, f.review_id AS reviewId, f.note, f.created_at AS createdAt, u.email AS user, r.redaction_count AS redactions
       FROM redaction_flags f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN reviews r ON r.id = f.review_id
       ORDER BY f.id DESC LIMIT ?`,
    )
    .all(limit) as { id: number; reviewId: number; note: string | null; createdAt: string; user: string | null; redactions: number | null }[];
}
