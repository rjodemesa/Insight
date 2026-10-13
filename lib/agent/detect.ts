import type Database from "better-sqlite3";
import { parseFilters, whereClause, type Filters } from "@/lib/query/filters";
import { themes, trend } from "@/lib/insights/queries";
import { compareProportions, daysBefore, type ProportionChange } from "@/lib/trend/stats";
import { sampleReviews, type SourceReview } from "@/lib/ai/grounding";

/**
 * The agent's detectors. Each one is a fixed statistical rule (DERIVED), so whether an
 * alert exists and how severe it is never depends on the AI; the AI only writes it up.
 * Every candidate has a dedupe key that includes its time window, so the same change is
 * proposed once, and again only when a new window shows it.
 */

export type AlertKind = "theme_rising" | "negative_share_rising" | "retailer_outlier";
export type Severity = "low" | "medium" | "high";

export interface Candidate {
  kind: AlertKind;
  key: string;
  title: string;
  severity: Severity;
  /** Plain statements with sample sizes; become the alert's numbered facts. */
  evidence: string[];
  drill: Record<string, string>;
  reviews: SourceReview[];
}

/** Brands checked one by one (largest first), and the review count they need. */
const MAX_BRANDS = 8;
const MIN_BRAND_REVIEWS = 300;
/** A rising theme needs at least this many negative mentions in the recent window. */
const MIN_RECENT_NEGATIVE = 10;
const RETAILER_WINDOW_DAYS = 90;
const MIN_RETAILER_TAGGED = 100;

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 1000) / 10}%`);
const n = (x: number) => x.toLocaleString("en-PH");

export function severity(c: ProportionChange): Severity {
  const pts = Math.abs(c.diffPts ?? 0);
  const z = Math.abs(c.z ?? 0);
  return pts >= 10 || z >= 5 ? "high" : pts >= 4 || z >= 3 ? "medium" : "low";
}

function themeRising(conn: Database.Database, f: Filters, scope: string, drillBase: Record<string, string>): Candidate[] {
  const t = themes(conn, f);
  if (!t.window) return [];
  const R = t.window.recent.reviews;
  return t.themes
    .filter((x) => x.negativeChange.significant && x.negativeChange.direction === "up" && (x.negativeChange.current ?? 0) * R >= MIN_RECENT_NEGATIVE)
    .slice(0, 5)
    .map((x) => {
      const c = x.negativeChange;
      return {
        kind: "theme_rising" as const,
        key: `theme_rising:${scope}:${x.theme}:${t.window!.recent.from}`,
        title: `${x.label} complaints rising${scope === "all" ? "" : ` for ${scope}`}`,
        severity: severity(c),
        evidence: [
          `${scope === "all" ? "Across all reviews" : `For ${scope}`}, negative mentions of ${x.label} were ${pct(c.current)} of reviews in the last ${t.window!.days} days (${t.window!.recent.from} to ${t.window!.recent.to}, n=${n(R)}), up from ${pct(c.previous)} in the ${3 * t.window!.days} days before (n=${n(t.window!.baseline.reviews)}); +${c.diffPts} points, z=${c.z}.`,
          `${x.label} has ${n(x.negative)} negative and ${n(x.positive)} positive mentions in total (${n(x.reviews)} reviews).`,
        ],
        drill: { ...drillBase, theme: x.theme, themeSentiment: "negative", from: t.window!.recent.from },
        reviews: sampleReviews(conn, f, { theme: [x.theme], themeSentiment: "negative", from: t.window!.recent.from }, "newest", 3),
      };
    });
}

function negativeShareRising(conn: Database.Database, f: Filters, scope: string, drillBase: Record<string, string>): Candidate[] {
  const t = trend(conn, f, "month");
  const ch = t.latestChange;
  if (!ch || !ch.negativeShare.significant || ch.negativeShare.direction !== "up") return [];
  const last = t.series.at(-1)!;
  const prev = t.series.at(-2)!;
  const tagged = (p: typeof last) => p.positive + p.neutral + p.negative;
  return [{
    kind: "negative_share_rising",
    key: `negative_share_rising:${scope}:${ch.period}`,
    title: `Negative reviews up in ${ch.period}${scope === "all" ? "" : ` for ${scope}`}`,
    severity: severity(ch.negativeShare),
    evidence: [
      `${scope === "all" ? "Across all reviews" : `For ${scope}`}, ${pct(ch.negativeShare.current)} of reviews with text in ${ch.period} were negative (n=${n(tagged(last))}), up from ${pct(ch.negativeShare.previous)} in ${ch.comparedWith} (n=${n(tagged(prev))}); +${ch.negativeShare.diffPts} points, z=${ch.negativeShare.z}.`,
      `${ch.period} is the latest month in the data and may be incomplete.`,
    ],
    drill: { ...drillBase, sentiment: "negative", from: `${ch.period}-01` },
    reviews: sampleReviews(conn, f, { sentiment: ["negative"], from: `${ch.period}-01` }, "helpful", 3),
  }];
}

function retailerOutliers(conn: Database.Database, f: Filters): Candidate[] {
  const w = whereClause(f);
  const max = conn.prepare(`SELECT MAX(r.review_date_iso) FROM reviews r WHERE ${w.sql}`).pluck().get(...w.params) as string | null;
  if (!max) return [];
  const from = daysBefore(max.slice(0, 10), RETAILER_WINDOW_DAYS - 1);
  const rows = conn
    .prepare(
      `SELECT r.retailer_name AS retailer, SUM(r.sentiment IS NOT NULL) AS tagged, SUM(r.sentiment = 'negative') AS negative
       FROM reviews r WHERE ${w.sql} AND r.review_date_iso >= ? AND r.retailer_name IS NOT NULL GROUP BY r.retailer_name`,
    )
    .all(...w.params, from) as { retailer: string; tagged: number; negative: number }[];
  const total = rows.reduce((s, r) => ({ tagged: s.tagged + r.tagged, negative: s.negative + r.negative }), { tagged: 0, negative: 0 });
  const out: (Candidate & { z: number })[] = [];
  for (const r of rows) {
    if (r.tagged < MIN_RETAILER_TAGGED) continue;
    const rest = { tagged: total.tagged - r.tagged, negative: total.negative - r.negative };
    const c = compareProportions(r.negative, r.tagged, rest.negative, rest.tagged);
    if (!c.significant || c.direction !== "up") continue;
    out.push({
      z: c.z ?? 0,
      kind: "retailer_outlier",
      key: `retailer_outlier:${r.retailer}:${from}`,
      title: `${r.retailer} has more negative reviews than other retailers`,
      severity: severity(c),
      evidence: [
        `In the last ${RETAILER_WINDOW_DAYS} days of data (${from} to ${max.slice(0, 10)}), ${pct(c.current)} of ${r.retailer} reviews with text were negative (n=${n(r.tagged)}), against ${pct(c.previous)} for all other retailers combined (n=${n(rest.tagged)}); +${c.diffPts} points, z=${c.z}.`,
      ],
      drill: { retailer: r.retailer, sentiment: "negative", from },
      reviews: sampleReviews(conn, f, { retailer: [r.retailer], sentiment: ["negative"], from }, "helpful", 3),
    });
  }
  return out.sort((a, b) => b.z - a.z).slice(0, 5).map(({ z: _z, ...c }) => c);
}

/** Runs every detector over all non-duplicate reviews, then over the largest brands. */
export function detect(conn: Database.Database): Candidate[] {
  const all = parseFilters(new URLSearchParams());
  const out = [...themeRising(conn, all, "all", {}), ...negativeShareRising(conn, all, "all", {}), ...retailerOutliers(conn, all)];
  const brands = conn
    .prepare("SELECT brand, COUNT(*) AS n FROM reviews WHERE is_duplicate = 0 AND brand IS NOT NULL GROUP BY brand HAVING n >= ? ORDER BY n DESC LIMIT ?")
    .all(MIN_BRAND_REVIEWS, MAX_BRANDS) as { brand: string }[];
  for (const { brand } of brands) {
    const f = { ...all, brand: [brand] };
    out.push(...themeRising(conn, f, brand, { brand }), ...negativeShareRising(conn, f, brand, { brand }));
  }
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
