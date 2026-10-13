import type Database from "better-sqlite3";
import { whereClause, type Filters } from "@/lib/query/filters";
import { REVIEW_COLUMNS, withThemes, type ReviewRow } from "@/lib/insights/queries";
import { analyzeReview } from "@/lib/nlp/analyze";

/**
 * Human verification of reviews the tagger is unsure about.
 *
 * Why a review is in the queue (any of the ticked reasons):
 *   - low confidence: sentiment confidence below the chosen threshold
 *     (0.30 exactly means the tagger found no sentiment words at all: "couldn't read")
 *   - mixed wording: it found sentiment words but they cancel out (|score| < MIXED_STRENGTH);
 *     on the imported data these contradict the star rating about 1 time in 8, against
 *     under 3 in 100 above it, at any confidence
 *   - stars disagree: the rating and the text point in opposite directions
 *
 * A verdict replaces the automatic sentiment everywhere (charts, exports, AI) and survives
 * reprocessing. "Unreadable" (spam, gibberish, off-topic) takes the review out of sentiment
 * like a review without text; it still counts toward ratings.
 */
type Conn = Database.Database;

export const UNREADABLE_CONFIDENCE = 0.3;
export const MIXED_STRENGTH = 0.35;
export const VERDICTS = ["positive", "neutral", "negative", "unreadable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export class VerifyError extends Error {}

export interface QueueOptions {
  /** Include reviews with confidence below this (0.3–1). null leaves confidence out. */
  threshold: number | null;
  mixed: boolean;
  conflict: boolean;
  sort: "uncertain" | "newest" | "rating_low" | "rating_high";
  limit: number;
  offset: number;
}

const UNVERIFIED = "r.verified_at IS NULL AND r.review_text <> '' AND r.sentiment IS NOT NULL";
const MIXED_SQL = `(r.confidence > ${UNREADABLE_CONFIDENCE} AND ABS(COALESCE(r.sentiment_score, 0)) < ${MIXED_STRENGTH})`;
const CONFLICT_SQL = "r.rating_text_conflict = 1";

const ORDER: Record<QueueOptions["sort"], string> = {
  // Stars-vs-text conflicts first, then mixed wording (weakest first), then unreadable, then by confidence.
  uncertain: `CASE WHEN ${CONFLICT_SQL} THEN 0 WHEN ${MIXED_SQL} THEN 1 WHEN r.confidence <= ${UNREADABLE_CONFIDENCE} THEN 2 ELSE 3 END,
    ABS(COALESCE(r.sentiment_score, 0)), r.confidence, r.id DESC`,
  newest: "r.review_date_iso DESC, r.id DESC",
  rating_low: "r.review_rating ASC, r.id DESC",
  rating_high: "r.review_rating DESC, r.id DESC",
};

function reasonSql(o: Pick<QueueOptions, "threshold" | "mixed" | "conflict">): { sql: string; params: number[] } {
  const ors: string[] = [];
  const params: number[] = [];
  if (o.threshold !== null) {
    ors.push("r.confidence < ?");
    params.push(o.threshold);
  }
  if (o.mixed) ors.push(MIXED_SQL);
  if (o.conflict) ors.push(CONFLICT_SQL);
  return { sql: ors.length ? `(${ors.join(" OR ")})` : "0", params };
}

/** Why each review is uncertain, for the labels on its card. */
function reasonsFor(r: ReviewRow, threshold: number | null): string[] {
  const out: string[] = [];
  if (r.ratingTextConflict === 1) out.push("stars_disagree");
  if ((r.confidence ?? 1) <= UNREADABLE_CONFIDENCE) out.push("unreadable");
  else if (Math.abs(r.sentimentScore ?? 0) < MIXED_STRENGTH) out.push("mixed");
  if (threshold !== null && (r.confidence ?? 1) < threshold && (r.confidence ?? 1) > UNREADABLE_CONFIDENCE) out.push("low_confidence");
  return out;
}

export function queue(conn: Conn, f: Filters, o: QueueOptions) {
  const w = whereClause(f);
  const reason = reasonSql(o);
  const where = `${w.sql} AND ${UNVERIFIED} AND ${reason.sql}`;
  const total = conn.prepare(`SELECT COUNT(*) FROM reviews r WHERE ${where}`).pluck().get(...w.params, ...reason.params) as number;
  const rows = conn
    .prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews r LEFT JOIN products p ON p.id = r.product_id WHERE ${where} ORDER BY ${ORDER[o.sort]} LIMIT ? OFFSET ?`)
    .all(...w.params, ...reason.params, o.limit, o.offset) as ReviewRow[];

  // Counts for each reason on its own, so the controls can show what each would add.
  const count = (extra: string, ...p: number[]) =>
    conn.prepare(`SELECT COUNT(*) FROM reviews r WHERE ${w.sql} AND ${UNVERIFIED} AND ${extra}`).pluck().get(...w.params, ...p) as number;
  const counts = {
    belowThreshold: o.threshold === null ? 0 : count("r.confidence < ?", o.threshold),
    unreadable: count(`r.confidence <= ${UNREADABLE_CONFIDENCE}`),
    mixed: count(MIXED_SQL),
    conflict: count(CONFLICT_SQL),
    withText: count("1=1"),
    verified: conn.prepare(`SELECT COUNT(*) FROM reviews r WHERE ${w.sql} AND r.verified_at IS NOT NULL`).pluck().get(...w.params) as number,
  };
  return {
    total, limit: o.limit, offset: o.offset, counts,
    reviews: withThemes(conn, rows).map((r) => ({ ...r, reasons: reasonsFor(r, o.threshold) })),
  };
}

/**
 * How trustworthy each confidence level is on this data: per 5-point band, how many reviews
 * and how often the automatic label contradicts the star rating (positive with 1–2 stars or
 * negative with 4–5). Star ratings never feed the tagger, so they are an independent check;
 * they are imperfect (people rate the seller, the courier, or by habit), so treat this as a guide.
 */
export function reliabilityBands(conn: Conn, f: Filters) {
  const w = whereClause(f);
  const rows = conn
    .prepare(
      `SELECT ROUND(r.confidence * 20) / 20.0 AS band, COUNT(*) AS n,
         SUM((r.sentiment = 'positive' AND r.review_rating <= 2) OR (r.sentiment = 'negative' AND r.review_rating >= 4)) AS contradict,
         SUM(r.sentiment = 'neutral' AND r.review_rating >= 4) AS neutralHigh
       FROM reviews r WHERE ${w.sql} AND r.sentiment IS NOT NULL AND r.verified_at IS NULL
       GROUP BY band ORDER BY band`,
    )
    .all(...w.params) as { band: number; n: number; contradict: number; neutralHigh: number }[];
  const total = rows.reduce((a, r) => a + r.n, 0);
  let cumulative = 0;
  return {
    total,
    bands: rows.map((r) => {
      cumulative += r.n;
      return {
        confidence: Math.round(r.band * 100) / 100,
        reviews: r.n,
        cumulativeShare: total ? Math.round((cumulative / total) * 1000) / 1000 : 0,
        contradictShare: r.n ? Math.round((r.contradict / r.n) * 1000) / 1000 : 0,
        neutralWithHighStars: r.neutralHigh,
      };
    }),
    method: "Each bar is a 5-point confidence band. The red share is how often the automatic label contradicts the star rating (positive with 1–2★ or negative with 4–5★). The tagger never reads the stars, so this is an independent but imperfect check: shoppers sometimes rate the seller or the delivery, not the product.",
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Records a person's verdict. Returns the previous automatic label for the audit trail. */
export function verify(conn: Conn, userId: number, reviewId: number, verdict: unknown) {
  if (!(VERDICTS as readonly unknown[]).includes(verdict)) throw new VerifyError("Choose positive, neutral, negative or unreadable.");
  const r = conn.prepare("SELECT id, sentiment, confidence, review_rating, verified_at FROM reviews WHERE id = ?").get(reviewId) as
    | { id: number; sentiment: string | null; confidence: number | null; review_rating: number | null; verified_at: string | null }
    | undefined;
  if (!r) throw new VerifyError("Review not found.");
  if (r.verified_at) throw new VerifyError("Someone already verified this review. Undo it first to change the verdict.");
  const v = verdict as Verdict;
  const human = v === "unreadable" ? null : v;
  const score = human === "positive" ? 0.5 : human === "negative" ? -0.5 : human === "neutral" ? 0 : null;
  const conflict = human === null || r.review_rating === null ? null : (r.review_rating >= 4 && human === "negative") || (r.review_rating <= 2 && human === "positive") ? 1 : 0;
  conn
    .prepare(
      `UPDATE reviews SET human_sentiment = ?, unclear = ?, sentiment = ?, sentiment_score = ?, confidence = ?,
         rating_text_conflict = ?, tag_source = 'human', verified_by = ?, verified_at = ${NOW} WHERE id = ?`,
    )
    .run(human, v === "unreadable" ? 1 : 0, human, score, human ? 1 : null, conflict, userId, reviewId);
  return { reviewId, verdict: v, previous: { sentiment: r.sentiment, confidence: r.confidence } };
}

/** Removes a verdict and puts the automatic label back. */
export function unverify(conn: Conn, reviewId: number) {
  const r = conn.prepare("SELECT review_title, review_text, review_rating, verified_at FROM reviews WHERE id = ?").get(reviewId) as
    | { review_title: string | null; review_text: string | null; review_rating: number | null; verified_at: string | null }
    | undefined;
  if (!r) throw new VerifyError("Review not found.");
  if (!r.verified_at) throw new VerifyError("This review has not been verified.");
  const a = analyzeReview({ title: r.review_title, text: r.review_text, rating: r.review_rating });
  conn
    .prepare(
      `UPDATE reviews SET human_sentiment = NULL, unclear = 0, verified_by = NULL, verified_at = NULL,
         sentiment = ?, sentiment_score = ?, confidence = ?, rating_text_conflict = ?, tag_source = ? WHERE id = ?`,
    )
    .run(a.sentiment, a.sentimentScore, a.confidence, a.ratingTextConflict, a.sentiment ? "rule" : null, reviewId);
  return { reviewId, restored: { sentiment: a.sentiment, confidence: a.confidence } };
}

/** The latest verdicts, for the "recently verified" list with Undo. */
export function recentVerifications(conn: Conn, limit = 20) {
  return conn
    .prepare(
      `SELECT r.id, r.human_sentiment AS sentiment, r.unclear, r.verified_at AS verifiedAt, u.email AS verifiedBy,
         r.review_rating AS rating, substr(r.review_text, 1, 140) AS text
       FROM reviews r LEFT JOIN users u ON u.id = r.verified_by WHERE r.verified_at IS NOT NULL ORDER BY r.verified_at DESC LIMIT ?`,
    )
    .all(limit) as { id: number; sentiment: string | null; unclear: number; verifiedAt: string; verifiedBy: string | null; rating: number | null; text: string }[];
}
