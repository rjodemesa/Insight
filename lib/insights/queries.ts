import type Database from "better-sqlite3";
import { whereClause, type Filters } from "@/lib/query/filters";
import { nlpVersion } from "@/lib/nlp/analyze";
import { taxonomy } from "@/lib/nlp/taxonomy";
import { INTELLIGENCE_FORMULA, intelligenceScore, rawScore, type ScoreInputs, type ScoreResult } from "@/lib/score/intelligence";
import { TRUST_FORMULA } from "@/lib/score/trust";
import { compareProportions, daysBefore } from "@/lib/trend/stats";
import type { Provenance } from "@/lib/theme";

/**
 * Read-side queries behind /api/reviews, /api/aggregates/* and /api/products.
 * Every function takes parsed Filters; every number it returns is OBSERVED (straight
 * from the data) or DERIVED (by a documented formula), as listed in `provenance`.
 * Duplicates are excluded unless the filters ask for them.
 */
type Conn = Database.Database;

/** Trust weight, defaulting to 1 for rows imported before Phase 2 and not yet reprocessed. */
const W = "COALESCE(r.trust_weight, 1)";

/** Aggregate columns that feed the Intelligence Score. Use inside a GROUP BY over `reviews r`. */
const SCORE_COLS = `
  COUNT(*) AS n,
  SUM(${W}) AS weight,
  SUM(CASE WHEN r.sentiment_score IS NOT NULL THEN ${W} * r.sentiment_score END)
    / NULLIF(SUM(CASE WHEN r.sentiment_score IS NOT NULL THEN ${W} END), 0) AS sentiment,
  SUM(CASE WHEN r.review_rating IS NOT NULL THEN ${W} * r.review_rating END)
    / NULLIF(SUM(CASE WHEN r.review_rating IS NOT NULL THEN ${W} END), 0) AS rating,
  SUM(CASE WHEN EXISTS (SELECT 1 FROM review_themes x WHERE x.review_id = r.id AND x.sentiment = 'negative') THEN ${W} ELSE 0 END)
    / NULLIF(SUM(${W}), 0) AS issue_share`;

interface ScoreRow {
  n: number;
  weight: number | null;
  sentiment: number | null;
  rating: number | null;
  issue_share: number | null;
}

const toInputs = (r: ScoreRow): ScoreInputs => ({
  n: r.n, weight: r.weight ?? 0, sentiment: r.sentiment, rating: r.rating, issueShare: r.n ? r.issue_share : null,
});

const round = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Raw score of the whole filtered set: the prior that group scores shrink toward. */
function priorFor(conn: Conn, f: Filters): number | null {
  const w = whereClause(f);
  const row = conn.prepare(`SELECT ${SCORE_COLS} FROM reviews r WHERE ${w.sql}`).get(...w.params) as ScoreRow;
  return row.n ? rawScore(toInputs(row)).raw : null;
}

export const SCORE_METHOD = { formula: INTELLIGENCE_FORMULA, trustWeight: TRUST_FORMULA };

// ---------------------------------------------------------------- summary

export function summary(conn: Conn, f: Filters) {
  const w = whereClause(f);
  const row = conn
    .prepare(
      `SELECT ${SCORE_COLS},
         SUM(r.review_text IS NOT NULL AND r.review_text <> '') AS with_text,
         AVG(r.review_rating) AS avg_rating,
         SUM(r.sentiment = 'positive') AS positive, SUM(r.sentiment = 'neutral') AS neutral,
         SUM(r.sentiment = 'negative') AS negative,
         SUM(r.rating_text_conflict = 1) AS conflicts,
         SUM(r.verified_purchase = 1) AS verified,
         SUM(r.review_text <> '' AND r.id NOT IN (SELECT review_id FROM review_themes)) AS untagged,
         SUM(r.verified_at IS NOT NULL) AS human_verified,
         COUNT(DISTINCT r.product_id) AS products, COUNT(DISTINCT r.brand) AS brands,
         COUNT(DISTINCT r.retailer_name) AS retailers,
         MIN(r.review_date_iso) AS date_from, MAX(r.review_date_iso) AS date_to
       FROM reviews r WHERE ${w.sql}`,
    )
    .get(...w.params) as ScoreRow & Record<string, number | string | null>;
  const tagged = Number(row.positive ?? 0) + Number(row.neutral ?? 0) + Number(row.negative ?? 0);
  const share = (x: unknown) => (tagged ? round(Number(x ?? 0) / tagged) : null);
  return {
    reviews: row.n,
    withText: Number(row.with_text ?? 0),
    averageRating: round(row.avg_rating as number | null, 2),
    sentiment: {
      positive: Number(row.positive ?? 0), neutral: Number(row.neutral ?? 0), negative: Number(row.negative ?? 0),
      positiveShare: share(row.positive), neutralShare: share(row.neutral), negativeShare: share(row.negative),
      weightedMean: round(row.sentiment),
    },
    ratingTextConflicts: Number(row.conflicts ?? 0),
    /** Reviews with text but no theme: candidates for AI tagging or new taxonomy rules. */
    untagged: Number(row.untagged ?? 0),
    /** Reviews whose sentiment a person has checked in the Verify queue. */
    humanVerified: Number(row.human_verified ?? 0),
    verifiedShare: row.n ? round(Number(row.verified ?? 0) / row.n) : null,
    products: Number(row.products ?? 0), brands: Number(row.brands ?? 0), retailers: Number(row.retailers ?? 0),
    dateRange: { from: row.date_from as string | null, to: row.date_to as string | null },
    // The whole set has nothing to shrink toward, so its score is the raw score.
    intelligenceScore: intelligenceScore(toInputs(row), null),
    provenance: {
      reviews: "OBSERVED", averageRating: "OBSERVED", verifiedShare: "OBSERVED", dateRange: "OBSERVED",
      sentiment: "DERIVED", ratingTextConflicts: "DERIVED", intelligenceScore: "DERIVED", products: "DERIVED",
    } satisfies Record<string, Provenance>,
    method: SCORE_METHOD,
  };
}

// ---------------------------------------------------------------- trend

export type Bucket = "month" | "week";
const BUCKET_SQL: Record<Bucket, string> = {
  month: "substr(r.review_date_iso, 1, 7)",
  // Monday of the review's week (weeks run Monday to Sunday).
  week: "date(r.review_date_iso, 'weekday 0', '-6 days')",
};

export function trend(conn: Conn, f: Filters, bucket: Bucket) {
  const w = whereClause(f);
  const rows = conn
    .prepare(
      `SELECT ${BUCKET_SQL[bucket]} AS period, COUNT(*) AS n,
         AVG(r.review_rating) AS avg_rating,
         SUM(r.sentiment = 'positive') AS positive, SUM(r.sentiment = 'neutral') AS neutral,
         SUM(r.sentiment = 'negative') AS negative,
         SUM(CASE WHEN r.sentiment_score IS NOT NULL THEN ${W} * r.sentiment_score END)
           / NULLIF(SUM(CASE WHEN r.sentiment_score IS NOT NULL THEN ${W} END), 0) AS weighted_sentiment,
         SUM(r.rating_text_conflict = 1) AS conflicts
       FROM reviews r WHERE ${w.sql} AND r.review_date_iso IS NOT NULL
       GROUP BY period ORDER BY period`,
    )
    .all(...w.params) as { period: string; n: number; avg_rating: number | null; positive: number; neutral: number; negative: number; weighted_sentiment: number | null; conflicts: number }[];
  const series = rows.map((r) => {
    const tagged = r.positive + r.neutral + r.negative;
    return {
      period: r.period, n: r.n, averageRating: round(r.avg_rating, 2),
      positive: r.positive, neutral: r.neutral, negative: r.negative,
      negativeShare: tagged ? round(r.negative / tagged) : null,
      weightedSentiment: round(r.weighted_sentiment), conflicts: r.conflicts,
    };
  });
  const last = series.at(-1);
  const prev = series.at(-2);
  const tagged = (s: typeof last) => (s ? s.positive + s.neutral + s.negative : 0);
  return {
    bucket,
    series,
    latestChange: last && prev
      ? { period: last.period, comparedWith: prev.period, negativeShare: compareProportions(last.negative, tagged(last), prev.negative, tagged(prev)) }
      : null,
    provenance: { n: "OBSERVED", averageRating: "OBSERVED", sentiment: "DERIVED", latestChange: "DERIVED" } satisfies Record<string, Provenance>,
    method: "Change is a two-proportion z-test on the negative share; significant when |z| ≥ 1.96 and both periods have at least 30 tagged reviews. The latest period may be incomplete.",
  };
}

// ---------------------------------------------------------------- themes

export function themes(conn: Conn, f: Filters, days = 30) {
  const w = whereClause(f);
  const filtered = `SELECT r.id, r.review_date_iso, r.sentiment FROM reviews r WHERE ${w.sql}`;
  const totals = conn
    .prepare(`WITH f AS (${filtered}) SELECT COUNT(*) AS n, SUM(sentiment IS NOT NULL) AS with_text, MAX(review_date_iso) AS max_date FROM f`)
    .get(...w.params) as { n: number; with_text: number | null; max_date: string | null };
  const withText = totals.with_text ?? 0;

  const maxDate = totals.max_date?.slice(0, 10) ?? null;
  const recentStart = maxDate ? daysBefore(maxDate, days - 1) : "9999-12-31";
  const baseStart = maxDate ? daysBefore(recentStart, 3 * days) : "9999-12-31";
  const windows = conn
    .prepare(
      `WITH f AS (${filtered}) SELECT
         SUM(sentiment IS NOT NULL AND review_date_iso >= ?) AS recent,
         SUM(sentiment IS NOT NULL AND review_date_iso >= ? AND review_date_iso < ?) AS base FROM f`,
    )
    .get(...w.params, recentStart, baseStart, recentStart) as { recent: number | null; base: number | null };

  const rows = conn
    .prepare(
      `WITH f AS (${filtered})
       SELECT t.theme, t.vector, COUNT(*) AS n,
         SUM(t.sentiment = 'positive') AS positive, SUM(t.sentiment = 'neutral') AS neutral,
         SUM(t.sentiment = 'negative') AS negative, AVG(t.confidence) AS confidence,
         SUM(t.source = 'rule') AS by_rule, SUM(t.source = 'AI') AS by_ai, SUM(t.source = 'human') AS by_human,
         SUM(f.review_date_iso >= ?) AS recent, SUM(f.review_date_iso >= ? AND f.review_date_iso < ?) AS base,
         SUM(t.sentiment = 'negative' AND f.review_date_iso >= ?) AS recent_neg,
         SUM(t.sentiment = 'negative' AND f.review_date_iso >= ? AND f.review_date_iso < ?) AS base_neg
       FROM review_themes t JOIN f ON f.id = t.review_id
       GROUP BY t.theme ORDER BY n DESC`,
    )
    .all(...w.params, recentStart, baseStart, recentStart, recentStart, baseStart, recentStart) as {
      theme: string; vector: string; n: number; positive: number; neutral: number; negative: number; confidence: number;
      by_rule: number; by_ai: number; by_human: number; recent: number; base: number; recent_neg: number; base_neg: number;
    }[];

  const tax = taxonomy();
  const R = windows.recent ?? 0;
  const B = windows.base ?? 0;
  const list = rows.map((r) => ({
    theme: r.theme,
    label: tax.byId.get(r.theme)?.label ?? r.theme,
    vector: r.vector,
    reviews: r.n,
    share: withText ? round(r.n / withText) : null,
    positive: r.positive, neutral: r.neutral, negative: r.negative,
    negativeShare: r.n ? round(r.negative / r.n) : null,
    averageConfidence: round(r.confidence, 2),
    sources: { rule: r.by_rule, AI: r.by_ai, human: r.by_human },
    change: compareProportions(r.recent, R, r.base, B),
    negativeChange: compareProportions(r.recent_neg, R, r.base_neg, B),
  }));

  const vectors = new Map<string, { vector: string; reviews: number; negative: number; themes: number }>();
  const vecRows = conn
    .prepare(
      `WITH f AS (${filtered})
       SELECT t.vector, COUNT(DISTINCT t.review_id) AS n,
         COUNT(DISTINCT CASE WHEN t.sentiment = 'negative' THEN t.review_id END) AS negative
       FROM review_themes t JOIN f ON f.id = t.review_id GROUP BY t.vector`,
    )
    .all(...w.params) as { vector: string; n: number; negative: number }[];
  for (const v of vecRows) vectors.set(v.vector, { vector: v.vector, reviews: v.n, negative: v.negative, themes: list.filter((t) => t.vector === v.vector).length });

  return {
    reviewsWithText: withText,
    window: maxDate ? { days, recent: { from: recentStart, to: maxDate, reviews: R }, baseline: { from: baseStart, to: daysBefore(recentStart, 1), reviews: B } } : null,
    vectors: [...vectors.values()].map((v) => ({
      ...v, share: withText ? round(v.reviews / withText) : null, negativeShare: v.reviews ? round(v.negative / v.reviews) : null,
    })),
    themes: list,
    provenance: { reviews: "DERIVED", share: "DERIVED", change: "DERIVED" } satisfies Record<string, Provenance>,
    method: `Themes are tagged by rules (config/taxonomy.json), plus AI tags on reviews the rules missed when AI tagging has been run. "change" compares the share of reviews mentioning the theme in the last ${days} days of the filtered data with the ${3 * days} days before (two-proportion z-test, |z| ≥ 1.96, at least 30 reviews in each window).`,
  };
}

// ---------------------------------------------------------------- group comparisons

function scoredGroups(conn: Conn, f: Filters, groupCol: string, extraCols = "") {
  const w = whereClause(f);
  const prior = priorFor(conn, f);
  const rows = conn
    .prepare(
      `SELECT ${groupCol} AS grp, ${SCORE_COLS},
         AVG(r.review_rating) AS avg_rating,
         SUM(r.sentiment = 'positive') AS positive, SUM(r.sentiment = 'neutral') AS neutral,
         SUM(r.sentiment = 'negative') AS negative, SUM(r.rating_text_conflict = 1) AS conflicts,
         SUM(r.verified_purchase = 1) AS verified ${extraCols}
       FROM reviews r WHERE ${w.sql} GROUP BY ${groupCol}`,
    )
    .all(...w.params) as (ScoreRow & { grp: string | number | null; avg_rating: number | null; positive: number; neutral: number; negative: number; conflicts: number; verified: number } & Record<string, unknown>)[];
  return {
    prior,
    rows: rows.map((r) => {
      const tagged = r.positive + r.neutral + r.negative;
      return {
        row: r,
        stats: {
          reviews: r.n,
          averageRating: round(r.avg_rating, 2),
          positiveShare: tagged ? round(r.positive / tagged) : null,
          negativeShare: tagged ? round(r.negative / tagged) : null,
          ratingTextConflicts: r.conflicts,
          verifiedShare: r.n ? round(r.verified / r.n) : null,
          intelligenceScore: intelligenceScore(toInputs(r), prior),
        },
      };
    }),
  };
}

const byScore = (a: { stats: { intelligenceScore: ScoreResult } }, b: { stats: { intelligenceScore: ScoreResult } }) =>
  (b.stats.intelligenceScore.score ?? -1) - (a.stats.intelligenceScore.score ?? -1);

const GROUP_PROVENANCE = {
  reviews: "OBSERVED", averageRating: "OBSERVED", verifiedShare: "OBSERVED",
  positiveShare: "DERIVED", negativeShare: "DERIVED", ratingTextConflicts: "DERIVED", intelligenceScore: "DERIVED",
} satisfies Record<string, Provenance>;

export function retailers(conn: Conn, f: Filters) {
  const g = scoredGroups(conn, f, "r.retailer_name");
  return {
    retailers: g.rows.sort(byScore).map(({ row, stats }) => ({ retailer: row.grp, ...stats })),
    prior: round(g.prior, 1), provenance: GROUP_PROVENANCE, method: SCORE_METHOD,
  };
}

export function brands(conn: Conn, f: Filters) {
  const g = scoredGroups(conn, f, "r.brand", ", COUNT(DISTINCT r.product_id) AS products");
  return {
    brands: g.rows.sort(byScore).map(({ row, stats }) => ({ brand: row.grp, products: row.products as number, ...stats })),
    prior: round(g.prior, 1), provenance: GROUP_PROVENANCE, method: SCORE_METHOD,
  };
}

export type ProductSort = "score" | "reviews" | "name" | "negative";

export function products(conn: Conn, f: Filters, sort: ProductSort = "score", limit = 200) {
  const g = scoredGroups(conn, f, "r.product_id");
  const ids = g.rows.map((r) => r.row.grp).filter((x): x is number => typeof x === "number");
  type Meta = { id: number; canonical_name: string; brand: string | null; category: string | null; subcategory: string | null; size_token: string | null; aliases: number };
  const meta = new Map<number, Meta>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = conn
      .prepare(
        `SELECT p.id, p.canonical_name, p.brand, p.category, p.subcategory, p.size_token,
           (SELECT COUNT(*) FROM product_aliases a WHERE a.product_id = p.id) AS aliases
         FROM products p WHERE p.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as Meta[];
    for (const r of rows) meta.set(r.id, r);
  }
  const list = g.rows
    .filter((r) => typeof r.row.grp === "number")
    .map(({ row, stats }) => {
      const m = meta.get(row.grp as number);
      return {
        id: row.grp as number, name: m?.canonical_name ?? null, brand: m?.brand ?? null, category: m?.category ?? null,
        subcategory: m?.subcategory ?? null, size: m?.size_token ?? null, aliases: m?.aliases ?? 0, ...stats,
      };
    });
  const sorters: Record<ProductSort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
    score: (a, b) => (b.intelligenceScore.score ?? -1) - (a.intelligenceScore.score ?? -1),
    reviews: (a, b) => b.reviews - a.reviews,
    name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
    negative: (a, b) => (b.negativeShare ?? -1) - (a.negativeShare ?? -1),
  };
  list.sort(sorters[sort]);
  const unmapped = g.rows.find((r) => r.row.grp === null)?.row.n ?? 0;
  return {
    total: list.length, products: list.slice(0, limit), unmappedReviews: unmapped,
    prior: round(g.prior, 1), provenance: GROUP_PROVENANCE, method: SCORE_METHOD,
  };
}

export function productDetail(conn: Conn, id: number, f: Filters) {
  const product = conn
    .prepare("SELECT id, canonical_name AS name, brand, category, subcategory, size_token AS size, created_at FROM products WHERE id = ?")
    .get(id) as { id: number; name: string; brand: string | null; category: string | null; subcategory: string | null } | undefined;
  if (!product) return null;
  const aliases = conn
    .prepare(
      `SELECT a.normalized_name, a.retailer_product_code, a.upc, a.similarity,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = a.product_id AND r.is_duplicate = 0) AS reviews
       FROM product_aliases a WHERE a.product_id = ? ORDER BY a.similarity DESC, a.id`,
    )
    .all(id);
  const own: Filters = { ...f, product: [id] };
  // Compare with the product's category under the same filters (minus the product itself).
  const peers: Filters = { ...f, product: [], category: product.category ? [product.category] : f.category };
  const prior = priorFor(conn, peers);
  const w = whereClause(own);
  const row = conn.prepare(`SELECT ${SCORE_COLS} FROM reviews r WHERE ${w.sql}`).get(...w.params) as ScoreRow;
  const retailerNames = conn
    .prepare(`SELECT r.retailer_name AS retailer, COUNT(*) AS reviews FROM reviews r WHERE ${w.sql} GROUP BY r.retailer_name ORDER BY reviews DESC`)
    .all(...w.params);
  return {
    product,
    aliases,
    retailers: retailerNames,
    intelligenceScore: intelligenceScore(toInputs(row), prior),
    comparedWith: product.category ? `category "${product.category}"` : "all reviews in the filter",
    summary: summary(conn, own),
    themes: themes(conn, own).themes,
    trend: trend(conn, own, "month").series,
    method: SCORE_METHOD,
  };
}

// ---------------------------------------------------------------- reviews

export type ReviewSort = "newest" | "oldest" | "helpful" | "rating_low" | "rating_high";
const ORDER: Record<ReviewSort, string> = {
  newest: "r.review_date_iso DESC, r.id DESC",
  oldest: "r.review_date_iso ASC, r.id ASC",
  helpful: "COALESCE(r.helpful_review_count, 0) DESC, r.id DESC",
  rating_low: "r.review_rating ASC, r.id DESC",
  rating_high: "r.review_rating DESC, r.id DESC",
};

export interface ReviewRow {
  id: number; retailer: string | null; productId: number | null; product: string | null; listingName: string | null;
  brand: string | null; category: string | null; subcategory: string | null; date: string | null; rating: number | null;
  title: string | null; text: string | null; language: string | null; sentiment: string | null; sentimentScore: number | null;
  confidence: number | null; ratingTextConflict: number | null; verified: number | null; helpful: number | null;
  images: number; trustWeight: number | null; redactions: number; duplicate: number; tagSource: string | null;
  /** The AI's second opinion on sentiment, when the review has been AI-tagged. */
  aiSentiment: string | null;
  /** Set when a person verified the sentiment on the Data tab. */
  verifiedAt: string | null;
  /** 1 when a person marked the text unreadable or spam. */
  unclear: number;
}

/** Columns behind ReviewRow, over `reviews r LEFT JOIN products p`. Redacted text only. */
export const REVIEW_COLUMNS = `r.id, r.retailer_name AS retailer, r.product_id AS productId, p.canonical_name AS product,
  r.product_name AS listingName, r.brand, r.category, r.subcategory,
  r.review_date_iso AS date, r.review_rating AS rating, r.review_title AS title, r.review_text AS text,
  r.language, r.sentiment, r.sentiment_score AS sentimentScore, r.confidence,
  r.rating_text_conflict AS ratingTextConflict, r.verified_purchase AS verified,
  r.helpful_review_count AS helpful, r.customer_image_count AS images, r.trust_weight AS trustWeight,
  r.redaction_count AS redactions, r.is_duplicate AS duplicate, r.tag_source AS tagSource,
  r.ai_sentiment AS aiSentiment, r.verified_at AS verifiedAt, r.unclear`;

/** Redacted reviews with their tags. Never returns review URLs or vault contents. */
export function listReviews(conn: Conn, f: Filters, opts: { sort: ReviewSort; limit: number; offset: number }) {
  const w = whereClause(f);
  const total = conn.prepare(`SELECT COUNT(*) FROM reviews r WHERE ${w.sql}`).pluck().get(...w.params) as number;
  const rows = conn
    .prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews r LEFT JOIN products p ON p.id = r.product_id
       WHERE ${w.sql} ORDER BY ${ORDER[opts.sort]} LIMIT ? OFFSET ?`)
    .all(...w.params, opts.limit, opts.offset) as ReviewRow[];
  return {
    total,
    limit: opts.limit,
    offset: opts.offset,
    reviews: withThemes(conn, rows),
    provenance: { text: "OBSERVED", rating: "OBSERVED", sentiment: "DERIVED", themes: "DERIVED", trustWeight: "DERIVED" } satisfies Record<string, Provenance>,
    note: "Text is redacted: personal data is replaced by tokens such as [PHONE_001].",
  };
}

export interface ThemeTagRow { theme: string; label: string; vector: string; sentiment: string | null; confidence: number | null; source: string }

/** Attaches each review's theme tags. */
export function withThemes<T extends { id: number }>(conn: Conn, rows: T[]): (T & { themes: ThemeTagRow[] })[] {
  const ids = rows.map((r) => r.id);
  const tags = new Map<number, ThemeTagRow[]>();
  if (ids.length) {
    const tax = taxonomy();
    const themeRows = conn
      .prepare(`SELECT review_id, theme, vector, sentiment, confidence, source FROM review_themes WHERE review_id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { review_id: number; theme: string; vector: string; sentiment: string | null; confidence: number | null; source: string }[];
    for (const t of themeRows) {
      const list = tags.get(t.review_id) ?? [];
      list.push({ theme: t.theme, label: tax.byId.get(t.theme)?.label ?? t.theme, vector: t.vector, sentiment: t.sentiment, confidence: t.confidence, source: t.source });
      tags.set(t.review_id, list);
    }
  }
  return rows.map((r) => ({ ...r, themes: tags.get(r.id) ?? [] }));
}

// ---------------------------------------------------------------- filter options

export function filterOptions(conn: Conn) {
  const distinct = (col: string) =>
    conn
      .prepare(`SELECT ${col} AS value, COUNT(*) AS reviews FROM reviews r WHERE r.is_duplicate = 0 AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY reviews DESC LIMIT 500`)
      .all() as { value: string; reviews: number }[];
  const range = conn
    .prepare("SELECT MIN(review_date_iso) AS from_, MAX(review_date_iso) AS to_ FROM reviews WHERE is_duplicate = 0")
    .get() as { from_: string | null; to_: string | null };
  const stale = conn
    .prepare("SELECT COUNT(*) FROM reviews WHERE nlp_version IS NULL OR nlp_version <> ?")
    .pluck()
    .get(nlpVersion()) as number;
  return {
    retailers: distinct("r.retailer_name"),
    categories: distinct("r.category"),
    subcategories: distinct("r.subcategory"),
    brands: distinct("r.brand"),
    languages: distinct("r.language"),
    sentiments: ["positive", "neutral", "negative", "none"],
    vectors: taxonomy().themes.reduce<string[]>((a, t) => (a.includes(t.vector) ? a : [...a, t.vector]), []),
    themes: taxonomy().themes,
    dateRange: { from: range.from_?.slice(0, 10) ?? null, to: range.to_?.slice(0, 10) ?? null },
    /** Reviews tagged with an older taxonomy or lexicon (or before Phase 2): run `npm run reprocess`. */
    staleReviews: stale,
  };
}
