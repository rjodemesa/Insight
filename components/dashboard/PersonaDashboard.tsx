"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { brands, products, retailers, summary, themes, trend } from "@/lib/insights/queries";
import type { operations } from "@/lib/insights/operations";
import { hoursSaved, keyFindings } from "@/lib/insights/derive";
import { PERSONA_DASHBOARDS, type PersonaKey } from "@/lib/personas";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import { num, pct } from "@/components/ui/format";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import SentimentTrend from "@/components/charts/SentimentTrend";
import ThemeBars from "@/components/charts/ThemeBars";
import ShareBars from "@/components/charts/ShareBars";
import RankingTable from "@/components/charts/RankingTable";
import KeyFindings from "./KeyFindings";
import AiSummary from "@/components/ai/AiSummary";

type Summary = ReturnType<typeof summary>;
type Themes = ReturnType<typeof themes>;
type Trend = ReturnType<typeof trend>;
type Retailers = ReturnType<typeof retailers>;
type Brands = ReturnType<typeof brands>;
type Products = ReturnType<typeof products>;
type Ops = ReturnType<typeof operations>;
type Theme = Themes["themes"][number];

/** Reviews a person must check for about ±5% margin at 95% confidence on sentiment accuracy. */
const VERIFY_SAMPLE = 385;
/** Products need this many reviews before they are ranked as low scorers. */
const MIN_PRODUCT_REVIEWS = 30;

/**
 * A dashboard for one persona: four headline tiles, two main panels and a "needs your
 * attention" list, all reading the same URL filters as the Overview. Picked in Views.
 */
export default function PersonaDashboard({ persona }: { persona: PersonaKey }) {
  const { query } = useFilters();
  const qs = withQuery(query);
  const s = useJson<Summary>(`/api/aggregates/summary${qs}`);
  const th = useJson<Themes>(`/api/aggregates/themes${qs}`);
  const ctx: Ctx = { query, qs, s, th };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {PERSONA_DASHBOARDS[persona].question}{" "}
        <Link href="/dashboard" className="text-brand underline">Back to Overview</Link>
      </p>
      <FilterBar collapsible />
      {s.error && <p role="alert" className="text-sm text-negative">{s.error}</p>}
      {persona === "leadership" && <Leadership {...ctx} />}
      {persona === "brand" && <Marketing {...ctx} />}
      {persona === "rnd" && <RnD {...ctx} />}
      {persona === "sales" && <Sales {...ctx} />}
      {persona === "analyst" && <Analyst {...ctx} />}
    </div>
  );
}

interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
interface Ctx {
  query: string;
  qs: string;
  s: Loaded<Summary>;
  th: Loaded<Themes>;
}

// ---------------------------------------------------------------- personas

function Leadership({ query, qs, s }: Ctx) {
  const b = useJson<Brands>(`/api/aggregates/brands${qs}`);
  const ops = useJson<Ops>("/api/aggregates/operations");
  const alerts = useJson<{ alerts: { id: number; title: string; severity: string; drill: Record<string, string> }[] }>("/api/alerts?status=approved");
  const minutes = ops.data?.estimates.minutesPerRecord ?? null;
  const hours = s.data && minutes !== null ? hoursSaved(s.data.reviews, minutes, ops.data?.latestImport?.durationMs ?? null) : null;
  return (
    <>
      <Tiles>
        <ScoreTile s={s.data} />
        <RatingTile s={s.data} />
        <StatTile label="Negative share" icon="▼" accent="warning" provenance="DERIVED" value={pct(s.data?.sentiment.negativeShare)}
          note="of reviews with text" href={drillHref(query, { sentiment: "negative", view: "reviews" })} />
        <StatTile label="Analyst hours saved" icon="⧗" accent="muted" provenance="ESTIMATED" value={hours === null ? "–" : num(hours)}
          unit={hours === null ? undefined : "h"} note={minutes !== null ? `at ${minutes} min per review` : undefined} />
      </Tiles>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingTable
          title="Brand comparison"
          subtitle="Brands in the portfolio by Intelligence Score."
          nameLabel="Brand"
          rows={(b.data?.brands ?? []).slice(0, 10).map((x) => ({
            key: String(x.brand), label: String(x.brand ?? "Unknown"), sub: `${num(x.products)} products`,
            href: drillHref(query, { brand: String(x.brand) }, "/insights/brand"),
            reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
          }))}
          exportKind="brands" query={query} loading={b.loading} error={b.error}
        />
        <AiSummary query={query} />
      </div>
      <Attention
        title="Approved alerts"
        loading={alerts.loading}
        empty="No approved alerts. Proposed alerts wait on the Alerts tab until someone approves them."
        items={(alerts.data?.alerts ?? []).map((a) => ({
          key: String(a.id), label: a.title, note: `${a.severity} severity`, href: drillHref("", { ...a.drill, view: "reviews" }),
        }))}
      />
    </>
  );
}

function Marketing({ query, qs, s, th }: Ctx) {
  const t = useJson<Trend>(`/api/aggregates/trend${qs}`);
  const communication = th.data?.vectors.find((v) => v.vector === "Communication");
  const list = th.data?.themes ?? [];
  const praised = [...list].sort((a, b) => b.positive - a.positive).filter((x) => x.positive > 0).slice(0, 5);
  const complained = [...list].sort((a, b) => b.negative - a.negative).filter((x) => x.negative > 0).slice(0, 5);
  return (
    <>
      <Tiles>
        <StatTile label="Positive share" icon="◐" accent="positive" provenance="DERIVED" value={pct(s.data?.sentiment.positiveShare, 0)}
          note={s.data ? `${pct(s.data.sentiment.negativeShare)} negative` : undefined} />
        <RatingTile s={s.data} />
        <StatTile label="Claims, ads and labels" icon="✎" provenance="DERIVED" value={num(communication?.reviews ?? (th.data ? 0 : null))}
          note="reviews in the Communication vector" href={drillHref(query, { vector: "Communication", view: "reviews" })} />
        <ScoreTile s={s.data} />
      </Tiles>
      <div className="grid gap-4 lg:grid-cols-2">
        <SentimentTrend data={t.data} query={query} loading={t.loading} error={t.error} />
        <Card title="Praised and complained about" provenance="DERIVED" subtitle="Themes with the most positive and the most negative mentions."
          loading={th.loading} error={th.error} empty={th.data && !list.length ? "No themes for these filters." : null}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ThemeList title="Most praised" themes={praised} count={(x) => x.positive} sentiment="positive" query={query} />
            <ThemeList title="Most complained about" themes={complained} count={(x) => x.negative} sentiment="negative" query={query} />
          </div>
        </Card>
      </div>
      <RisingComplaints themes={list} loading={th.loading} query={query} />
    </>
  );
}

function RnD({ query, qs, s, th }: Ctx) {
  const p = useJson<Products>(`/api/products?${query ? `${query}&` : ""}sort=reviews&limit=1000`);
  const productThemes = filterThemes(th.data, ["Product", "Packaging"]);
  const ranked = (p.data?.products ?? []).filter((x) => x.reviews >= MIN_PRODUCT_REVIEWS && x.intelligenceScore.score !== null);
  const below = p.data?.prior != null ? ranked.filter((x) => (x.intelligenceScore.score ?? 100) < (p.data?.prior ?? 0)) : [];
  const worst = [...ranked].sort((a, b) => (a.intelligenceScore.score ?? 0) - (b.intelligenceScore.score ?? 0)).slice(0, 10);
  return (
    <>
      <Tiles>
        <StatTile label="Negative share" icon="▼" accent="warning" provenance="DERIVED" value={pct(s.data?.sentiment.negativeShare)}
          note="of reviews in view" href={drillHref(query, { sentiment: "negative", view: "reviews" })} />
        <StatTile label="Leaks, caps and seals" icon="◌" accent="warning" provenance="DERIVED"
          value={num(th.data ? negativeMentions(th.data, ["leak", "cap_seal", "damaged_packaging"]) : null)} note="negative mentions"
          href={drillHref(query, { vector: null, theme: ["leak", "cap_seal", "damaged_packaging"], themeSentiment: "negative", view: "reviews" })} />
        <StatTile label="Products below average" icon="▣" provenance="DERIVED" value={p.data ? num(below.length) : "–"}
          note={p.data ? `of ${num(ranked.length)} with ${MIN_PRODUCT_REVIEWS}+ reviews` : undefined} href={drillHref(query, { view: "products" })} />
        <RisingTile themes={productThemes?.themes ?? null} />
      </Tiles>
      <div className="grid gap-4 lg:grid-cols-2">
        <ThemeBars data={productThemes} query={query} loading={th.loading} error={th.error} limit={10} />
        <RankingTable
          title="Lowest-scoring products"
          subtitle={`Products with ${MIN_PRODUCT_REVIEWS}+ reviews in view, worst Intelligence Score first.`}
          nameLabel="Product"
          rows={worst.map((x) => ({
            key: String(x.id), label: x.name ?? `Product ${x.id}`, sub: x.brand,
            href: drillHref(query, {}, `/insights/product/${x.id}`),
            reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
          }))}
          exportKind="products" query={query} loading={p.loading} error={p.error}
        />
      </div>
      <RisingComplaints themes={productThemes?.themes ?? []} loading={th.loading} query={query} />
    </>
  );
}

function Sales({ query, qs, s, th }: Ctx) {
  const router = useRouter();
  const r = useJson<Retailers>(`/api/aggregates/retailers${qs}`);
  const retailThemes = filterThemes(th.data, ["Retail Execution"]);
  const retail = th.data?.vectors.find((v) => v.vector === "Retail Execution");
  const retailerCount = r.data?.retailers.length ?? 0;
  return (
    <>
      <Tiles>
        <StatTile label="Retail Execution negative share" icon="▼" accent="warning" provenance="DERIVED" value={pct(retail?.negativeShare)}
          note={retail ? `of ${num(retail.reviews)} reviews mentioning it` : undefined}
          href={drillHref(query, { vector: "Retail Execution", themeSentiment: "negative", view: "reviews" })} />
        <StatTile label="Delivery and seller issues" icon="⇄" accent="warning" provenance="DERIVED"
          value={num(th.data ? negativeMentions(th.data, ["delivery_speed", "seller_service", "wrong_missing_item"]) : null)} note="negative mentions"
          href={drillHref(query, { vector: null, theme: ["delivery_speed", "seller_service", "wrong_missing_item"], themeSentiment: "negative", view: "reviews" })} />
        <StatTile label="Authenticity and expiry" icon="⚠" provenance="DERIVED"
          value={num(th.data ? mentions(th.data, ["authenticity", "expiry"]) : null)} note="mentions"
          href={drillHref(query, { vector: null, theme: ["authenticity", "expiry"], view: "reviews" })} />
        <StatTile label="Verified purchases" icon="✓" provenance="OBSERVED" value={pct(s.data?.verifiedShare, 0)} note="of reviews in view" />
      </Tiles>
      <div className="grid gap-4 lg:grid-cols-2">
        <ThemeBars data={retailThemes} query={query} loading={th.loading} error={th.error} limit={10} />
        <ShareBars
          title="Retailer comparison"
          subtitle={retailerCount === 1
            ? "Only one retailer in the data so far. Import another retailer's reviews to compare."
            : "Negative share of tagged reviews per retailer."}
          measure="Negative share"
          minN={30}
          rows={(r.data?.retailers ?? []).map((x) => ({
            key: String(x.retailer), label: String(x.retailer ?? "Unknown"), value: x.negativeShare, n: x.reviews,
            details: [{ label: "Average rating", value: x.averageRating?.toFixed(2) ?? "–" }],
          }))}
          onOpen={(k) => router.push(drillHref(query, { retailer: k, sentiment: "negative", view: "reviews" }))}
          exportKind="retailers" query={query} loading={r.loading} error={r.error}
        />
      </div>
      <RisingComplaints themes={retailThemes?.themes ?? []} loading={th.loading} query={query} />
    </>
  );
}

function Analyst({ query, qs, s, th }: Ctx) {
  const router = useRouter();
  const ops = useJson<Ops>("/api/aggregates/operations");
  const t = useJson<Trend>(`/api/aggregates/trend${qs}`);
  const r = useJson<Retailers>(`/api/aggregates/retailers${qs}`);
  const fb = useJson<{ totals: { tags: number; redactions: number } }>("/api/feedback");
  const findings = useMemo(
    () => (s.data && th.data && r.data ? keyFindings({ summary: s.data, themes: th.data, retailers: r.data, trend: t.data }) : null),
    [s.data, th.data, r.data, t.data],
  );
  const verified = s.data?.humanVerified ?? null;
  const quality = ops.data?.latestImport?.qualityScore;
  return (
    <>
      <Tiles>
        <StatTile label="Data quality (latest import)" icon="◈" provenance="DERIVED" value={quality?.toFixed(1) ?? "–"}
          unit={quality != null ? "/100" : undefined} note={ops.data?.latestImport ? `${num(ops.data.latestImport.rows)} rows` : undefined} href="/data" />
        <StatTile label="Rating disagrees with text" icon="≠" accent="warning" provenance="DERIVED" value={num(s.data?.ratingTextConflicts)}
          note="worth reading first" href={drillHref(query, { conflict: "true", view: "reviews" })} />
        <StatTile label="Untagged reviews" icon="?" accent="warning" provenance="DERIVED" value={num(s.data?.untagged)}
          note="text but no theme: AI-tag candidates" />
        <StatTile label="Reviews verified" icon="✓" provenance="OBSERVED" value={num(verified)}
          unit={verified !== null ? `/ ${VERIFY_SAMPLE}` : undefined} note="sample for a ±5% accuracy figure" href="/data" />
      </Tiles>
      <div className="grid gap-4 lg:grid-cols-2">
        <KeyFindings findings={findings} query={query} loading={s.loading || th.loading || r.loading} />
        <ShareBars
          title="Theme coverage by vector"
          subtitle="Share of reviews with text that have at least one theme in each vector."
          measure="Share of reviews with text"
          rows={(th.data?.vectors ?? []).map((v) => ({ key: v.vector, label: v.vector, value: v.share, n: v.reviews }))}
          onOpen={(v) => router.push(drillHref(query, { vector: v, view: "reviews" }))}
          query={query} loading={th.loading} error={th.error}
        />
      </div>
      <Attention
        title="Feedback to triage"
        loading={fb.loading}
        empty="No feedback yet."
        items={fb.data ? [
          { key: "tags", label: `${num(fb.data.totals.tags)} tag corrections`, note: "suggested changes to themes", href: "/data" },
          { key: "pii", label: `${num(fb.data.totals.redactions)} missed-redaction flags`, note: "an IT officer checks these", href: "/data" },
          { key: "conflicts", label: `${num(s.data?.ratingTextConflicts)} rating-vs-text conflicts`, note: "read and verify", href: drillHref(query, { conflict: "true", view: "reviews" }) },
        ] : []}
      />
    </>
  );
}

// ---------------------------------------------------------------- shared pieces

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

function ScoreTile({ s }: { s: Summary | null }) {
  return (
    <StatTile label="Intelligence Score" icon="◆" provenance="DERIVED" value={s?.intelligenceScore.score?.toFixed(1) ?? "–"}
      unit={s?.intelligenceScore.score != null ? "/100" : undefined} note="an index, not a probability" />
  );
}

function RatingTile({ s }: { s: Summary | null }) {
  return (
    <StatTile label="Average rating" icon="★" provenance="OBSERVED" value={s?.averageRating?.toFixed(2) ?? "–"}
      unit={s?.averageRating ? "/5" : undefined} note={s ? `${num(s.reviews)} reviews` : undefined} />
  );
}

/** Themes whose share of negative mentions rose significantly in the latest window. */
const rising = (list: Theme[]) => list.filter((x) => x.negativeChange.direction === "up");

function RisingTile({ themes: list }: { themes: Theme[] | null }) {
  return (
    <StatTile label="Rising complaint themes" icon="↗" accent="warning" provenance="DERIVED" value={list ? num(rising(list).length) : "–"}
      note="significant rise, last 30 days" />
  );
}

function RisingComplaints({ themes: list, loading, query }: { themes: Theme[]; loading: boolean; query: string }) {
  return (
    <Attention
      title="Rising complaints"
      loading={loading}
      empty="No complaint theme is rising significantly in the last 30 days."
      items={rising(list).map((x) => ({
        key: x.theme, label: x.label,
        note: `negative mentions ${x.negativeChange.diffPts! > 0 ? "+" : ""}${x.negativeChange.diffPts} pts · ${x.vector}`,
        href: drillHref(query, { vector: null, theme: x.theme, themeSentiment: "negative", view: "reviews" }),
      }))}
    />
  );
}

function Attention({ title, items, empty, loading }: { title: string; items: { key: string; label: string; note?: string; href: string }[]; empty: string; loading: boolean }) {
  return (
    <Card title={`Needs your attention: ${title.toLowerCase()}`} loading={loading} empty={!loading && !items.length ? empty : null}>
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-baseline gap-2">
            <Link href={i.href} className="text-brand underline">{i.label}</Link>
            {i.note && <span className="text-xs text-ink-muted">{i.note}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ThemeList({ title, themes: list, count, sentiment, query }: {
  title: string; themes: Theme[]; count: (t: Theme) => number; sentiment: "positive" | "negative"; query: string;
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ol className="space-y-1 text-sm">
        {list.map((x) => (
          <li key={x.theme} className="flex items-baseline justify-between gap-2">
            <Link href={drillHref(query, { theme: x.theme, themeSentiment: sentiment, view: "reviews" })} className="text-brand underline">{x.label}</Link>
            <span className={`tabular-nums ${sentiment === "positive" ? "text-positive" : "text-negative"}`}>{num(count(x))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The themes response limited to some vectors, for ThemeBars. */
function filterThemes(data: Themes | null, vectors: string[]): Themes | null {
  return data ? { ...data, themes: data.themes.filter((x) => vectors.includes(x.vector)) } : null;
}

const mentions = (data: Themes, ids: string[]) => data.themes.filter((x) => ids.includes(x.theme)).reduce((a, x) => a + x.reviews, 0);
const negativeMentions = (data: Themes, ids: string[]) => data.themes.filter((x) => ids.includes(x.theme)).reduce((a, x) => a + x.negative, 0);
