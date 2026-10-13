"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { brands, retailers, summary, themes, trend } from "@/lib/insights/queries";
import type { operations } from "@/lib/insights/operations";
import { keyFindings } from "@/lib/insights/derive";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import { num, pct } from "@/components/ui/format";
import MethodPanel from "@/components/ui/MethodPanel";
import SentimentTrend from "@/components/charts/SentimentTrend";
import ThemeBars from "@/components/charts/ThemeBars";
import ShareBars from "@/components/charts/ShareBars";
import RankingTable from "@/components/charts/RankingTable";
import KpiRow from "./KpiRow";
import KeyFindings from "./KeyFindings";

type Summary = ReturnType<typeof summary>;
type Trend = ReturnType<typeof trend>;
type Themes = ReturnType<typeof themes>;
type Retailers = ReturnType<typeof retailers>;
type Brands = ReturnType<typeof brands>;
type Ops = ReturnType<typeof operations>;

/** One-glance view for every persona. Each panel reads the same URL filters; each drills down to reviews. */
export default function Dashboard() {
  const router = useRouter();
  const { query } = useFilters();
  const qs = withQuery(query);
  const s = useJson<Summary>(`/api/aggregates/summary${qs}`);
  const t = useJson<Trend>(`/api/aggregates/trend${qs}`);
  const th = useJson<Themes>(`/api/aggregates/themes${qs}`);
  const r = useJson<Retailers>(`/api/aggregates/retailers${qs}`);
  const b = useJson<Brands>(`/api/aggregates/brands${qs}`);
  const ops = useJson<Ops>("/api/aggregates/operations");

  const findings = useMemo(
    () => (s.data && th.data && r.data ? keyFindings({ summary: s.data, themes: th.data, retailers: r.data, trend: t.data }) : null),
    [s.data, th.data, r.data, t.data],
  );
  const open = (extra: Record<string, string | null>) => router.push(drillHref(query, { ...extra, view: "reviews" }));

  return (
    <div className="space-y-4">
      <FilterBar />
      {s.error && <p role="alert" className="text-sm text-negative">{s.error}</p>}
      <KpiRow s={s.data} ops={ops.data} query={query} onOpsChange={ops.reload} />
      <KeyFindings findings={findings} query={query} loading={s.loading || th.loading || r.loading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SentimentTrend data={t.data} query={query} loading={t.loading} error={t.error} />
        <ThemeBars data={th.data} query={query} loading={th.loading} error={th.error} limit={10} />
        <ShareBars
          title="Issues by Five Vectors"
          subtitle="Share of reviews mentioning each vector where the mention is negative."
          measure="Negative share"
          rows={(th.data?.vectors ?? []).map((v) => ({
            key: v.vector, label: v.vector, value: v.negativeShare, n: v.reviews,
            details: [{ label: "Negative mentions", value: num(v.negative) }, { label: "Share of reviews with text", value: pct(v.share) }],
          }))}
          onOpen={(v) => open({ vector: v, themeSentiment: "negative" })}
          query={query}
          loading={th.loading}
          error={th.error}
        />
        <ShareBars
          title="Retailer comparison"
          subtitle="Negative share of tagged reviews per retailer."
          measure="Negative share"
          minN={30}
          rows={(r.data?.retailers ?? []).map((x) => ({
            key: String(x.retailer), label: String(x.retailer ?? "Unknown"), value: x.negativeShare, n: x.reviews,
            details: [
              { label: "Average rating", value: x.averageRating?.toFixed(2) ?? "–" },
              { label: "Intelligence Score", value: x.intelligenceScore.score?.toFixed(1) ?? "–" },
            ],
          }))}
          onOpen={(k) => open({ retailer: k, sentiment: "negative" })}
          exportKind="retailers"
          query={query}
          loading={r.loading}
          error={r.error}
        />
      </div>

      <RankingTable
        title="Brand ranking"
        subtitle="By Intelligence Score, shrunk toward the overall score so small brands do not top the list on a handful of reviews."
        nameLabel="Brand"
        rows={(b.data?.brands ?? []).slice(0, 15).map((x) => ({
          key: String(x.brand), label: String(x.brand ?? "Unknown"), sub: `${num(x.products)} products`,
          href: drillHref(query, { brand: String(x.brand) }, "/insights/brand"),
          reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
        }))}
        exportKind="brands"
        query={query}
        loading={b.loading}
        error={b.error}
        footer={b.data && b.data.brands.length > 15 ? (
          <p className="mt-2 text-xs text-ink-muted">Top 15 of {num(b.data.brands.length)} brands. See all on the Insights tab or export.</p>
        ) : null}
      />

      {s.data && (
        <MethodPanel
          items={[
            { label: "Intelligence Score", text: s.data.method.formula },
            { label: "Trust weight", text: s.data.method.trustWeight },
            ...(t.data ? [{ label: "Trend change", text: t.data.method }] : []),
            ...(th.data ? [{ label: "Themes", text: th.data.method }] : []),
            ...(ops.data ? [
              { label: "Data-quality score", text: ops.data.method.qualityScore },
              { label: "Analyst hours saved (ESTIMATED)", text: ops.data.method.hoursSaved },
            ] : []),
            { label: "Sentiment", text: "Rule-based lexicon for English, Filipino and Taglish with negation, intensifiers, slang and emoji, with the star rating as a weak prior. Reviews without text are counted in ratings but not in sentiment or themes." },
          ]}
        />
      )}
    </div>
  );
}
