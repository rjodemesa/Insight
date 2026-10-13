import type { retailers, summary, themes, trend } from "./queries";

/**
 * Pure calculations shared by the server and the browser (no database, no Node APIs).
 * keyFindings() turns aggregates the dashboard already has into short DERIVED statements:
 * the deterministic stand-in for the AI summary until Phase 4, and later the facts that
 * summary is grounded in.
 */

/** Analyst hours saved (ESTIMATED): manual reading time minus processing time. Never negative. */
export function hoursSaved(reviews: number, minutesPerRecord: number, processingMs: number | null): number {
  const manual = (reviews * minutesPerRecord) / 60;
  return Math.max(0, Math.round((manual - (processingMs ?? 0) / 3_600_000) * 10) / 10);
}

export interface Finding {
  kind: "overview" | "issue" | "rising" | "falling" | "retailer" | "conflict" | "data";
  text: string;
  /** Filters (query-string pairs) that show the reviews behind the finding. */
  drill?: Record<string, string>;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 1000) / 10}%`);
const n = (x: number) => x.toLocaleString("en-PH");

export function keyFindings(input: {
  summary: ReturnType<typeof summary>;
  themes: ReturnType<typeof themes>;
  retailers: ReturnType<typeof retailers>;
  trend?: ReturnType<typeof trend> | null;
}): Finding[] {
  const { summary: s, themes: t, retailers: r } = input;
  const out: Finding[] = [];
  if (!s.reviews) return [{ kind: "data", text: "No reviews match the current filters." }];

  const tagged = s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative;
  out.push({
    kind: "overview",
    text: `${n(s.reviews)} reviews (${n(tagged)} with text): ${pct(s.sentiment.positiveShare)} positive, ${pct(s.sentiment.negativeShare)} negative; average rating ${s.averageRating ?? "–"}.`,
  });

  const issues = t.themes.filter((x) => x.negative > 0).sort((a, b) => b.negative - a.negative).slice(0, 3);
  if (issues.length) {
    out.push({
      kind: "issue",
      text: `Top complaints: ${issues.map((x) => `${x.label} (${n(x.negative)})`).join(", ")}.`,
      drill: { theme: issues[0]!.theme, themeSentiment: "negative" },
    });
  }

  const rising = t.themes.filter((x) => x.negativeChange.significant && x.negativeChange.direction === "up").sort((a, b) => (b.negativeChange.diffPts ?? 0) - (a.negativeChange.diffPts ?? 0));
  for (const x of rising.slice(0, 2)) {
    out.push({
      kind: "rising",
      text: `Complaints about ${x.label} rose from ${pct(x.negativeChange.previous)} to ${pct(x.negativeChange.current)} of reviews in the last ${t.window?.days ?? 30} days (n=${n(t.window?.recent.reviews ?? 0)}).`,
      drill: { theme: x.theme, themeSentiment: "negative", ...(t.window ? { from: t.window.recent.from } : {}) },
    });
  }
  const falling = t.themes.find((x) => x.negativeChange.significant && x.negativeChange.direction === "down");
  if (falling) {
    out.push({
      kind: "falling",
      text: `Complaints about ${falling.label} fell from ${pct(falling.negativeChange.previous)} to ${pct(falling.negativeChange.current)} of reviews.`,
      drill: { theme: falling.theme, themeSentiment: "negative" },
    });
  }

  const ranked = r.retailers.filter((x) => x.reviews >= 30 && x.negativeShare !== null);
  if (ranked.length >= 2) {
    const worst = ranked.reduce((a, b) => ((b.negativeShare ?? 0) > (a.negativeShare ?? 0) ? b : a));
    out.push({
      kind: "retailer",
      text: `${worst.retailer} has the highest negative share among retailers with 30+ reviews: ${pct(worst.negativeShare)} (n=${n(worst.reviews)}).`,
      drill: { retailer: String(worst.retailer), sentiment: "negative" },
    });
  }

  const change = input.trend?.latestChange?.negativeShare;
  if (change?.significant) {
    out.push({
      kind: change.direction === "up" ? "rising" : "falling",
      text: `Negative share in ${input.trend!.latestChange!.period} was ${pct(change.current)}, ${change.direction} from ${pct(change.previous)} in ${input.trend!.latestChange!.comparedWith} (the latest period may be incomplete).`,
    });
  }

  if (s.ratingTextConflicts > 0) {
    out.push({
      kind: "conflict",
      text: `${n(s.ratingTextConflicts)} reviews have a star rating that disagrees with their text; worth reading before trusting ratings alone.`,
      drill: { conflict: "true" },
    });
  }
  const noText = s.reviews - tagged;
  if (noText / s.reviews > 0.2) {
    out.push({ kind: "data", text: `${pct(noText / s.reviews)} of reviews have no text, so they count toward ratings but not themes or sentiment.` });
  }
  return out;
}
