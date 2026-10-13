import type Database from "better-sqlite3";
import type { Filters } from "@/lib/query/filters";
import { cached } from "@/lib/insights/cache";
import { brands, retailers, summary, themes, trend } from "@/lib/insights/queries";
import { arr, bad, obj, str, type AIProvider, type AITask } from "./provider";
import { buildFacts, cite, GROUNDING_RULES, renderContext, sampleReviews, uniqueReviews, type Fact, type SourceReview } from "./grounding";

/**
 * The AI summary on the Dashboard: a headline and a few points written from the same
 * numbers as the rule-based Key findings, plus a handful of sample reviews.
 */

/** The aggregates behind the facts, cached like the dashboard's own requests. */
export function loadAggregates(conn: Database.Database, f: Filters, key: string) {
  return cached(`ai-aggregates?${key}`, () => ({
    summary: summary(conn, f),
    themes: themes(conn, f),
    retailers: retailers(conn, f),
    brands: brands(conn, f),
    trend: trend(conn, f, "month"),
  }));
}

export interface CitedText {
  text: string;
  facts: string[];
  reviews: number[];
}

export interface AISummary {
  headline: CitedText;
  points: CitedText[];
  caveat: string | null;
  facts: Fact[];
  reviews: Pick<SourceReview, "id" | "date" | "rating" | "retailer" | "brand">[];
  reviewsInScope: number;
  droppedCitations: number;
}

interface Raw {
  headline: string;
  points: string[];
  caveat: string;
}

const SYSTEM = `You summarise consumer reviews for P&G Philippines brand and category managers.
Write a one-sentence headline and 3 to 5 short points: what stands out, what is getting worse or better, and where to look first. Prefer issues a team can act on.
Add a one-sentence caveat about data limits when the facts mention any (small samples, incomplete months, reviews without text), otherwise an empty string.

${GROUNDING_RULES}`;

export function summaryTask(facts: Fact[], reviews: SourceReview[]): AITask<Raw> {
  return {
    name: "summary",
    system: SYSTEM,
    prompt: renderContext(facts, reviews),
    maxOutputTokens: 4096,
    schema: {
      type: "OBJECT",
      properties: {
        headline: { type: "STRING" },
        points: { type: "ARRAY", items: { type: "STRING" } },
        caveat: { type: "STRING" },
      },
      required: ["headline", "points", "caveat"],
    },
    parse(raw) {
      const o = obj(raw, "summary");
      const headline = str(o.headline, 400);
      const points = arr(o.points).map((p) => str(p, 600)).filter(Boolean).slice(0, 6);
      if (!headline && points.length === 0) bad("empty summary");
      return { headline, points, caveat: str(o.caveat, 400) };
    },
    mock() {
      // Repeats the rule-based findings with their markers: grounded, but not a real model.
      const issueReview = reviews.find((r) => r.sentiment === "negative");
      const [first, ...rest] = facts;
      return {
        headline: first ? `${first.text} [${first.id}]` : "No reviews match the current filters.",
        points: rest.slice(0, 4).map((f, i) => `${f.text} [${f.id}]${i === 0 && issueReview ? ` [R${issueReview.id}]` : ""}`),
        caveat: "Written by the offline mock provider, which restates the key findings. Set AI_PROVIDER=gemini for a model-written summary.",
      };
    },
  };
}

export async function aiSummary(conn: Database.Database, f: Filters, key: string, provider: AIProvider) {
  const agg = loadAggregates(conn, f, key);
  const facts = buildFacts(agg);
  const topIssue = agg.themes.themes.filter((t) => t.negative > 0).sort((a, b) => b.negative - a.negative)[0];
  const rising = agg.themes.themes.find((t) => t.negativeChange.significant && t.negativeChange.direction === "up" && t.theme !== topIssue?.theme);
  const reviews = agg.summary.reviews
    ? uniqueReviews(
        topIssue ? sampleReviews(conn, f, { theme: [topIssue.theme], themeSentiment: "negative" }, "helpful", 4) : [],
        rising ? sampleReviews(conn, f, { theme: [rising.theme], themeSentiment: "negative" }, "newest", 3) : [],
        sampleReviews(conn, f, { sentiment: ["positive"] }, "helpful", 3),
      )
    : [];
  const result = await provider.run(summaryTask(facts, reviews));
  const headline = cite(result.data.headline, facts, reviews);
  const points = result.data.points.map((p) => cite(p, facts, reviews));
  const used = new Set([...headline.reviews, ...points.flatMap((p) => p.reviews)]);
  const body: AISummary = {
    headline: { text: headline.text, facts: headline.facts, reviews: headline.reviews },
    points: points.filter((p) => p.text).map((p) => ({ text: p.text, facts: p.facts, reviews: p.reviews })),
    caveat: result.data.caveat || null,
    facts,
    reviews: reviews.filter((r) => used.has(r.id)).map(({ id, date, rating, retailer, brand }) => ({ id, date, rating, retailer, brand })),
    reviewsInScope: agg.summary.reviews,
    droppedCitations: headline.dropped + points.reduce((s, p) => s + p.dropped, 0),
  };
  return { body, result, sent: { facts: facts.length, reviews: reviews.length } };
}
