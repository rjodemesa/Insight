import type Database from "better-sqlite3";
import { describeFilters, type Filters } from "@/lib/query/filters";
import { cached } from "@/lib/insights/cache";
import { filterOptions } from "@/lib/insights/queries";
import { analyzeReview } from "@/lib/nlp/analyze";
import { taxonomy } from "@/lib/nlp/taxonomy";
import { arr, bad, obj, str, type AIProvider, type AITask } from "./provider";
import { buildFacts, cite, GROUNDING_RULES, renderContext, sampleReviews, uniqueReviews, type Fact, type SourceReview } from "./grounding";
import { loadAggregates, type CitedText } from "./summary";

/**
 * Ask AI: a question about the reviews under the current filters. The question narrows
 * the scope when it names a brand or retailer, and picks the reviews to read when it
 * names a theme ("leaks", "amoy"). The model answers only from those facts and reviews.
 */

export const MAX_QUESTION = 500;
export interface Turn {
  question: string;
  answer: string;
}

const NEGATIVE_INTENT = /\b(complain\w*|complaint\w*|problem\w*|issue\w*|negative|bad|worst|poor|wrong|fail\w*|reklamo|problema|pangit|sira|ayaw|hindi maganda)\b/i;
const POSITIVE_INTENT = /\b(prais\w*|positive|best|good|love\w*|like\w*|strength\w*|maganda|gusto|paborito|bilib)\b/i;

export function detectScope(conn: Database.Database, f: Filters, question: string) {
  const themeIds = [...new Set(analyzeReview({ title: null, text: question, rating: null }).themes.map((t) => t.theme))];
  const lower = ` ${question.toLowerCase()} `;
  for (const t of taxonomy().themes) if (!themeIds.includes(t.id) && lower.includes(` ${t.label.toLowerCase()} `)) themeIds.push(t.id);
  const opts = cached("ai-filter-options", () => filterOptions(conn));
  const named = (list: { value: string }[]) =>
    list.map((o) => o.value).filter((v) => v.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(v.toLowerCase())}([^\\p{L}\\p{N}]|$)`, "u").test(lower));
  const brands = f.brand.length ? [] : named(opts.brands).slice(0, 5);
  const retailers = f.retailer.length ? [] : named(opts.retailers).slice(0, 5);
  const intent: "negative" | "positive" | null = NEGATIVE_INTENT.test(question) ? "negative" : POSITIVE_INTENT.test(question) ? "positive" : null;
  const scoped: Filters = { ...f, brand: brands.length ? brands : f.brand, retailer: retailers.length ? retailers : f.retailer };
  return { scoped, themes: themeIds.slice(0, 3), brands, retailers, intent };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Raw {
  answer: string;
  insufficient: boolean;
  followUps: string[];
}

const SYSTEM = `You answer questions from P&G Philippines teams about consumer reviews of their products.
Answer in 2 to 6 sentences, in the language of the question (English, Filipino or Taglish). Lead with the direct answer, then the evidence.
Set "insufficient" to true when the facts and reviews cannot answer the question. Suggest up to 3 short follow-up questions that these data could answer.

${GROUNDING_RULES}`;

export function askTask(question: string, history: Turn[], facts: Fact[], reviews: SourceReview[], focus: Fact[]): AITask<Raw> {
  const earlier = history.length
    ? `EARLIER IN THIS CONVERSATION (for context only; cite nothing from it)\n${history.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join("\n")}\n\n`
    : "";
  return {
    name: "ask",
    system: SYSTEM,
    prompt: `${earlier}${renderContext(facts, reviews)}\n\nQUESTION\n${question}`,
    maxOutputTokens: 4096,
    schema: {
      type: "OBJECT",
      properties: {
        answer: { type: "STRING" },
        insufficient: { type: "BOOLEAN" },
        followUps: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["answer", "insufficient", "followUps"],
    },
    parse(raw) {
      const o = obj(raw, "answer");
      const answer = str(o.answer, 2000);
      if (!answer) bad("empty answer");
      return { answer, insufficient: o.insufficient === true, followUps: arr(o.followUps).map((q) => str(q, 200)).filter(Boolean).slice(0, 3) };
    },
    mock() {
      if (!reviews.length && facts.length <= 1) {
        return { answer: "No reviews match these filters, so there is nothing to answer from.", insufficient: true, followUps: [] };
      }
      const lead = (focus.length ? focus : facts).slice(0, 3);
      const examples = reviews.slice(0, 2).map((r) => `[R${r.id}]`).join(" ");
      return {
        answer: `${lead.map((x) => `${x.text} [${x.id}]`).join(" ")}${examples ? ` Example reviews: ${examples}.` : ""} (Offline mock answer: it restates the closest computed facts and does not read the question closely.)`,
        insufficient: false,
        followUps: ["Which retailer has the highest negative share?", "What are the top complaints in the last 30 days?"],
      };
    },
  };
}

export interface AskAnswer {
  answer: CitedText;
  insufficient: boolean;
  followUps: string[];
  facts: Fact[];
  reviews: SourceReview[];
  scope: Record<string, unknown>;
  detected: { themes: string[]; brands: string[]; retailers: string[] };
  reviewsInScope: number;
  reviewsRead: number;
  droppedCitations: number;
}

export async function ask(conn: Database.Database, f: Filters, question: string, history: Turn[], provider: AIProvider) {
  const scope = detectScope(conn, f, question);
  const key = JSON.stringify(describeFilters(scope.scoped));
  const agg = loadAggregates(conn, scope.scoped, key);
  const facts = buildFacts(agg);

  // Facts about the themes the question names, even when they are outside the top 10.
  const focus: Fact[] = [];
  for (const id of scope.themes) {
    const t = agg.themes.themes.find((x) => x.theme === id);
    const label = taxonomy().byId.get(id)?.label ?? id;
    const c = t?.negativeChange;
    const text = t
      ? `Theme "${t.label}": ${t.reviews.toLocaleString("en-PH")} reviews mention it (${t.negative.toLocaleString("en-PH")} negative, ${t.positive.toLocaleString("en-PH")} positive). ` +
        (c && c.current !== null && c.previous !== null
          ? `Negative mentions were ${Math.round(c.current * 1000) / 10}% of reviews in the last ${agg.themes.window?.days ?? 30} days vs ${Math.round(c.previous * 1000) / 10}% before (${c.significant ? "a significant change" : "not a significant change"}).`
          : "Not enough recent data to compare periods.")
      : `No reviews in scope mention "${label}".`;
    const fact = { id: `F${facts.length + 1}`, text, drill: { theme: id } };
    facts.push(fact);
    focus.push(fact);
  }

  const polarity = scope.intent === "positive" ? "positive" : "negative";
  const reviews = !agg.summary.reviews
    ? []
    : scope.themes.length
      ? uniqueReviews(...scope.themes.slice(0, 2).map((t) => sampleReviews(conn, scope.scoped, { theme: [t], themeSentiment: scope.intent ? polarity : null }, "helpful", 6)))
      : scope.intent
        ? sampleReviews(conn, scope.scoped, { sentiment: [polarity] }, "helpful", 10)
        : uniqueReviews(
            sampleReviews(conn, scope.scoped, { sentiment: ["negative"] }, "helpful", 5),
            sampleReviews(conn, scope.scoped, { sentiment: ["positive"] }, "helpful", 5),
          );

  const result = await provider.run(askTask(question, history, facts, reviews, focus));
  const answer = cite(result.data.answer, facts, reviews);
  const tax = taxonomy();
  const body: AskAnswer = {
    answer: { text: answer.text, facts: answer.facts, reviews: answer.reviews },
    insufficient: result.data.insufficient,
    followUps: result.data.followUps,
    facts,
    reviews: reviews.filter((r) => answer.reviews.includes(r.id)),
    scope: describeFilters(scope.scoped),
    detected: { themes: scope.themes.map((t) => tax.byId.get(t)?.label ?? t), brands: scope.brands, retailers: scope.retailers },
    reviewsInScope: agg.summary.reviews,
    reviewsRead: reviews.length,
    droppedCitations: answer.dropped,
  };
  return { body, result, sent: { facts: facts.length, reviews: reviews.length } };
}
