import type Database from "better-sqlite3";
import { whereClause, type Filters } from "@/lib/query/filters";
import { Z_CRITICAL } from "@/lib/trend/stats";
import type { Provenance } from "@/lib/theme";

/**
 * Star-rating views: the shopping-site style rating breakdown, and the brand comparison
 * by reviews (visibility) and ratings. Everything here is OBSERVED counts or DERIVED from
 * them by the formulas in `method`.
 */
type Conn = Database.Database;
const round = (x: number | null, d = 3) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Counts per star for the filters, ignoring the rating, "with comments" and "with photos"
 * filters themselves, so every chip can show how many reviews it would select.
 */
export function ratingSummary(conn: Conn, f: Filters) {
  const w = whereClause({ ...f, minRating: null, maxRating: null, hasText: null, hasPhotos: null });
  const rows = conn
    .prepare(`SELECT CAST(ROUND(r.review_rating) AS INTEGER) AS star, COUNT(*) AS n FROM reviews r WHERE ${w.sql} GROUP BY star`)
    .all(...w.params) as { star: number | null; n: number }[];
  const t = conn
    .prepare(
      `SELECT COUNT(*) AS total, AVG(r.review_rating) AS avg, SUM(r.review_text <> '') AS withText, SUM(r.customer_image_count > 0) AS withPhotos
       FROM reviews r WHERE ${w.sql}`,
    )
    .get(...w.params) as { total: number; avg: number | null; withText: number | null; withPhotos: number | null };
  const stars = [5, 4, 3, 2, 1].map((s) => ({ star: s, reviews: rows.find((r) => r.star === s)?.n ?? 0 }));
  const rated = stars.reduce((a, s) => a + s.reviews, 0);
  return {
    total: t.total,
    rated,
    noRating: t.total - rated,
    averageRating: round(t.avg, 2),
    stars: stars.map((s) => ({ ...s, share: rated ? round(s.reviews / rated) : null })),
    withText: t.withText ?? 0,
    withPhotos: t.withPhotos ?? 0,
    provenance: { stars: "OBSERVED", averageRating: "OBSERVED" } satisfies Record<string, Provenance>,
  };
}

/** A brand must be this many stars above or below the rest, as well as statistically different, to be flagged. */
export const MIN_STAR_GAP = 0.05;
export const MIN_RATED = 30;

export type Verdict = "over" | "under" | "in_line" | "too_few";

export const BRAND_METHOD = {
  visibility: "Visibility is the brand's share of all reviews under the current filters (its share of voice).",
  verdict: `A brand is an overperformer (or underperformer) when its average star rating is at least ${MIN_STAR_GAP} stars above (or below) the average of all other brands combined AND the gap is statistically significant (Welch z-test, |z| ≥ ${Z_CRITICAL}, assuming each brand's ratings vary at least as much as the whole portfolio's, so a brand with only 5★ ratings is not treated as certain). Brands with fewer than ${MIN_RATED} rated reviews are not judged.`,
};

interface Agg {
  n: number;
  rated: number;
  sum: number;
  sumsq: number;
  s1: number; s2: number; s3: number; s4: number; s5: number;
  tagged: number;
  negative: number;
  products: number;
}

const variance = (a: { rated: number; sum: number; sumsq: number }) =>
  a.rated > 1 ? Math.max(0, (a.sumsq - (a.sum * a.sum) / a.rated) / (a.rated - 1)) : 0;

export function brandComparison(conn: Conn, f: Filters) {
  const w = whereClause(f);
  const cols = `COUNT(*) AS n, COUNT(r.review_rating) AS rated, COALESCE(SUM(r.review_rating), 0) AS sum,
    COALESCE(SUM(r.review_rating * r.review_rating), 0) AS sumsq,
    SUM(ROUND(r.review_rating) = 1) AS s1, SUM(ROUND(r.review_rating) = 2) AS s2, SUM(ROUND(r.review_rating) = 3) AS s3,
    SUM(ROUND(r.review_rating) = 4) AS s4, SUM(ROUND(r.review_rating) = 5) AS s5,
    SUM(r.sentiment IS NOT NULL) AS tagged, SUM(r.sentiment = 'negative') AS negative, COUNT(DISTINCT r.product_id) AS products`;
  const rows = conn
    .prepare(`SELECT COALESCE(r.brand, 'Unknown') AS brand, ${cols} FROM reviews r WHERE ${w.sql} GROUP BY COALESCE(r.brand, 'Unknown')`)
    .all(...w.params) as (Agg & { brand: string })[];
  const all = rows.reduce<Agg>(
    (a, r) => ({
      n: a.n + r.n, rated: a.rated + r.rated, sum: a.sum + r.sum, sumsq: a.sumsq + r.sumsq,
      s1: a.s1 + (r.s1 ?? 0), s2: a.s2 + (r.s2 ?? 0), s3: a.s3 + (r.s3 ?? 0), s4: a.s4 + (r.s4 ?? 0), s5: a.s5 + (r.s5 ?? 0),
      tagged: a.tagged + (r.tagged ?? 0), negative: a.negative + (r.negative ?? 0), products: 0,
    }),
    { n: 0, rated: 0, sum: 0, sumsq: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, tagged: 0, negative: 0, products: 0 },
  );
  const overallMean = all.rated ? all.sum / all.rated : null;
  // A brand whose ratings are all 5★ has no spread, which would make any gap look certain.
  // Each brand is assumed to vary at least as much as the portfolio does.
  const floor = variance(all);

  const brands = rows.map((r) => {
    const mean = r.rated ? r.sum / r.rated : null;
    const rest = { rated: all.rated - r.rated, sum: all.sum - r.sum, sumsq: all.sumsq - r.sumsq };
    const restMean = rest.rated ? rest.sum / rest.rated : null;
    let z: number | null = null;
    if (mean !== null && restMean !== null && r.rated > 1 && rest.rated > 1) {
      const se = Math.sqrt(Math.max(variance(r), floor) / r.rated + variance(rest) / rest.rated);
      z = se === 0 ? 0 : (mean - restMean) / se;
    }
    const gap = mean !== null && restMean !== null ? mean - restMean : null;
    const verdict: Verdict =
      r.rated < MIN_RATED || z === null || gap === null ? "too_few"
        : Math.abs(z) >= Z_CRITICAL && Math.abs(gap) >= MIN_STAR_GAP ? (gap > 0 ? "over" : "under")
          : "in_line";
    const low = (r.s1 ?? 0) + (r.s2 ?? 0);
    return {
      brand: r.brand,
      reviews: r.n,
      visibility: all.n ? round(r.n / all.n, 4) : null,
      products: r.products,
      rated: r.rated,
      averageRating: round(mean, 2),
      gapToRest: round(gap, 3),
      z: round(z, 2),
      verdict,
      stars: { 5: r.s5 ?? 0, 4: r.s4 ?? 0, 3: r.s3 ?? 0, 2: r.s2 ?? 0, 1: r.s1 ?? 0 },
      lowRatingShare: r.rated ? round(low / r.rated) : null,
      negativeShare: r.tagged ? round((r.negative ?? 0) / r.tagged) : null,
    };
  });
  brands.sort((a, b) => b.reviews - a.reviews);
  return {
    totalReviews: all.n,
    averageRating: round(overallMean, 2),
    lowRatingShare: all.rated ? round((all.s1 + all.s2) / all.rated) : null,
    brands,
    provenance: { reviews: "OBSERVED", averageRating: "OBSERVED", visibility: "DERIVED", verdict: "DERIVED" } satisfies Record<string, Provenance>,
    method: BRAND_METHOD,
  };
}
