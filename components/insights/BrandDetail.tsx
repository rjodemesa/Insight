"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { brands, products, retailers, summary, themes, trend } from "@/lib/insights/queries";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import StatTile from "@/components/ui/StatTile";
import { num, pct } from "@/components/ui/format";
import SentimentTrend from "@/components/charts/SentimentTrend";
import ThemeBars from "@/components/charts/ThemeBars";
import ShareBars from "@/components/charts/ShareBars";
import RankingTable from "@/components/charts/RankingTable";
import ScoreBreakdown from "./ScoreBreakdown";

type Summary = ReturnType<typeof summary>;
type Trend = ReturnType<typeof trend>;
type Themes = ReturnType<typeof themes>;
type Retailers = ReturnType<typeof retailers>;
type Brands = ReturnType<typeof brands>;
type Products = ReturnType<typeof products>;

/**
 * One brand (the `brand` filter): its score against all brands under the other filters,
 * trend, themes, retailers and products.
 */
export default function BrandDetail() {
  const router = useRouter();
  const f = useFilters();
  const brand = f.getAll("brand");
  const query = f.query;
  // The brand's score is computed among all brands, so ask without the brand filter.
  const peers = drillHref(query, { brand: null }, "").replace(/^\?/, "");
  const qs = withQuery(query);
  const s = useJson<Summary>(brand.length ? `/api/aggregates/summary${qs}` : null);
  const t = useJson<Trend>(brand.length ? `/api/aggregates/trend${qs}` : null);
  const th = useJson<Themes>(brand.length ? `/api/aggregates/themes${qs}` : null);
  const r = useJson<Retailers>(brand.length ? `/api/aggregates/retailers${qs}` : null);
  const p = useJson<Products>(brand.length ? `/api/products${withQuery([query, "limit=100"].join("&"))}` : null);
  const all = useJson<Brands>(brand.length === 1 ? `/api/aggregates/brands${withQuery(peers)}` : null);
  const mine = all.data?.brands.find((b) => b.brand === brand[0]);
  const rank = all.data && mine ? all.data.brands.indexOf(mine) + 1 : null;

  if (!brand.length) {
    return (
      <p className="text-sm">
        Pick a brand with the Brand filter, or choose one from <Link href="/insights?view=brands" className="text-brand underline">the brand list</Link>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href={drillHref(peers, { view: "brands" })} className="text-sm text-brand underline">← All brands</Link>
        <h1 className="mt-1 text-2xl font-semibold">{brand.join(", ")}</h1>
        {rank && all.data && <p className="text-sm text-ink-muted">Ranked {rank} of {num(all.data.brands.length)} brands by Intelligence Score under these filters.</p>}
      </div>
      <FilterBar />

      {s.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Reviews" provenance="OBSERVED" value={num(s.data.reviews)} href={drillHref(query, { view: "reviews" })} />
          <StatTile label="Products" provenance="DERIVED" value={num(s.data.products)} />
          <StatTile label="Average rating" provenance="OBSERVED" value={s.data.averageRating?.toFixed(2) ?? "–"} />
          <StatTile label="Negative share" provenance="DERIVED" value={pct(s.data.sentiment.negativeShare)}
            href={drillHref(query, { sentiment: "negative", view: "reviews" })} />
          <StatTile label="Verified purchases" provenance="OBSERVED" value={pct(s.data.verifiedShare, 0)} />
        </div>
      )}
      {mine && all.data && (
        <ScoreBreakdown s={mine.intelligenceScore} comparedWith="all brands under the same filters" formula={all.data.method.formula} trustWeight={all.data.method.trustWeight} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SentimentTrend data={t.data} query={query} loading={t.loading} error={t.error} />
        <ThemeBars data={th.data} query={query} loading={th.loading} error={th.error} limit={10} />
        <ShareBars
          title="Retailers"
          subtitle="Negative share of this brand's tagged reviews per retailer."
          measure="Negative share"
          minN={30}
          rows={(r.data?.retailers ?? []).map((x) => ({
            key: String(x.retailer), label: String(x.retailer ?? "Unknown"), value: x.negativeShare, n: x.reviews,
            details: [{ label: "Average rating", value: x.averageRating?.toFixed(2) ?? "–" }],
          }))}
          onOpen={(k) => router.push(drillHref(query, { retailer: k, sentiment: "negative", view: "reviews" }))}
          exportKind="retailers"
          query={query}
          loading={r.loading}
          error={r.error}
        />
        <RankingTable
          title="Products"
          nameLabel="Product"
          rows={(p.data?.products ?? []).map((x) => ({
            key: String(x.id), label: x.name ?? `Product ${x.id}`, sub: [x.subcategory, x.size].filter(Boolean).join(" · "),
            href: `/insights/product/${x.id}${withQuery(peers)}`,
            reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
          }))}
          exportKind="products"
          query={query}
          loading={p.loading}
          error={p.error}
        />
      </div>
    </div>
  );
}
