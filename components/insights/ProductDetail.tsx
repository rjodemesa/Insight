"use client";

import Link from "next/link";
import type { productDetail, themes, trend } from "@/lib/insights/queries";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import Card from "@/components/ui/Card";
import StatTile from "@/components/ui/StatTile";
import { num, pct } from "@/components/ui/format";
import SentimentTrend from "@/components/charts/SentimentTrend";
import ThemeBars from "@/components/charts/ThemeBars";
import ReviewViewer from "./ReviewViewer";
import ScoreBreakdown from "./ScoreBreakdown";

type Detail = NonNullable<ReturnType<typeof productDetail>>;
type Themes = ReturnType<typeof themes>;
type Trend = ReturnType<typeof trend>;

/** One canonical product: score against its category, trend, themes, listing names, retailers and reviews. */
export default function ProductDetail({ id }: { id: number }) {
  const { query } = useFilters();
  // Every panel and drill-down on this page is scoped to the product.
  const scoped = drillHref(query, { product: String(id) }, "").replace(/^\?/, "");
  const d = useJson<Detail>(`/api/products/${id}${withQuery(query)}`);
  const t = useJson<Trend>(`/api/aggregates/trend?${scoped}`);
  const th = useJson<Themes>(`/api/aggregates/themes?${scoped}`);
  const p = d.data?.product;
  const s = d.data?.summary;

  return (
    <div className="space-y-4">
      <div>
        <Link href={drillHref(query, { view: "products" })} className="text-sm text-brand underline">← All products</Link>
        <h1 className="mt-1 text-2xl font-semibold">{p?.name ?? (d.error ? "Product" : "Loading…")}</h1>
        {p && (
          <p className="text-sm text-ink-muted">
            {[p.brand, p.category, p.subcategory].filter(Boolean).join(" · ")} · product #{p.id}
          </p>
        )}
      </div>
      {d.error && <p role="alert" className="text-sm text-negative">{d.error}</p>}
      <FilterBar />

      {d.data && s && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Reviews" provenance="OBSERVED" value={num(s.reviews)} note={`${num(s.withText)} with text`} />
            <StatTile label="Average rating" provenance="OBSERVED" value={s.averageRating?.toFixed(2) ?? "–"} />
            <StatTile label="Negative share" provenance="DERIVED" value={pct(s.sentiment.negativeShare)}
              href={drillHref(scoped, { sentiment: "negative", view: "reviews" })} note={`${pct(s.sentiment.positiveShare, 0)} positive`} />
            <StatTile label="Verified purchases" provenance="OBSERVED" value={pct(s.verifiedShare, 0)} />
          </div>
          <ScoreBreakdown s={d.data.intelligenceScore} comparedWith={d.data.comparedWith} formula={d.data.method.formula} trustWeight={d.data.method.trustWeight} />
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SentimentTrend data={t.data} query={scoped} loading={t.loading} error={t.error} />
        <ThemeBars data={th.data} query={scoped} loading={th.loading} error={th.error} limit={10} />
      </div>

      {d.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Listing names mapped here" provenance="DERIVED"
            subtitle="Retailer listings grouped into this product."
            actions={<Link href={`/data?section=mapping&mapping=${id}`} className="text-xs text-brand underline">Fix mapping</Link>}>
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {(d.data.aliases as { normalized_name: string; retailer_product_code: string | null; similarity: number | null }[]).map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex-1">{a.normalized_name}{a.retailer_product_code && <span className="text-xs text-ink-muted"> · code {a.retailer_product_code}</span>}</span>
                  <span className="tabular-nums text-xs text-ink-muted" title="Name similarity when matched (1 = exact)">{a.similarity?.toFixed(2) ?? "–"}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Retailers" provenance="OBSERVED">
            <ul className="space-y-1 text-sm">
              {(d.data.retailers as { retailer: string | null; reviews: number }[]).map((r) => (
                <li key={r.retailer ?? "none"} className="flex gap-2">
                  {r.retailer ? (
                    <Link href={drillHref(scoped, { retailer: r.retailer, view: "reviews" })} className="flex-1 text-brand hover:underline">{r.retailer}</Link>
                  ) : (
                    <span className="flex-1">Unknown</span>
                  )}
                  <span className="tabular-nums">{num(r.reviews)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <ReviewViewer extra={`product=${id}`} title="Reviews of this product" />
    </div>
  );
}
