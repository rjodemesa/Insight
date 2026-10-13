"use client";

import Link from "next/link";
import type { brands, products, themes } from "@/lib/insights/queries";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import { num } from "@/components/ui/format";
import RankingTable from "@/components/charts/RankingTable";
import ThemeBars from "@/components/charts/ThemeBars";
import MethodPanel from "@/components/ui/MethodPanel";
import ReviewViewer from "./ReviewViewer";
import ThemeExplorer from "./ThemeExplorer";

type Themes = ReturnType<typeof themes>;
type Products = ReturnType<typeof products>;
type Brands = ReturnType<typeof brands>;

const VIEWS = [
  ["themes", "Themes"], ["products", "Products"], ["brands", "Brands"], ["reviews", "Reviews"],
] as const;
type View = (typeof VIEWS)[number][0];
const PRODUCT_SORTS = [["score", "Score"], ["negative", "Most negative"], ["reviews", "Most reviews"], ["name", "Name"]] as const;

/** Theme explorer, product and brand rankings, and the review viewer, all under the same URL filters. */
export default function InsightsWorkspace() {
  const f = useFilters();
  const view = (VIEWS.some(([v]) => v === f.get("view")) ? f.get("view") : "themes") as View;
  return (
    <div className="space-y-4">
      <FilterBar />
      <nav aria-label="Insights views" className="flex gap-1 border-b border-line">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={drillHref(f.query, { view: v })}
            aria-current={view === v ? "page" : undefined}
            className={`-mb-px rounded-t border px-4 py-1.5 text-sm ${view === v ? "border-line border-b-surface bg-surface font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {view === "themes" && <ThemesView query={f.query} />}
      {view === "products" && <ProductsView query={f.query} sort={f.get("psort") ?? "score"} onSort={(s) => f.set("psort", s)} />}
      {view === "brands" && <BrandsView query={f.query} />}
      {view === "reviews" && <ReviewViewer />}
    </div>
  );
}

function ThemesView({ query }: { query: string }) {
  const th = useJson<Themes>(`/api/aggregates/themes${withQuery(query)}`);
  return (
    <div className="space-y-4">
      <ThemeBars data={th.data} query={query} loading={th.loading} error={th.error} limit={15} />
      <ThemeExplorer data={th.data} query={query} loading={th.loading} error={th.error} />
    </div>
  );
}

function ProductsView({ query, sort, onSort }: { query: string; sort: string; onSort: (s: string) => void }) {
  const p = useJson<Products>(`/api/products${withQuery([query, `sort=${sort}`, "limit=300"].filter(Boolean).join("&"))}`);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        Sort by
        <select value={sort} onChange={(e) => onSort(e.target.value)} className="rounded border border-line bg-surface px-1 py-1">
          {PRODUCT_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <RankingTable
        title="Products"
        subtitle={p.data ? `${num(p.data.total)} products${p.data.total > 300 ? " (first 300 shown; export for all)" : ""}. Scores shrink toward ${p.data.prior ?? "–"}, the score of everything in the filter.` : undefined}
        nameLabel="Product"
        rows={(p.data?.products ?? []).map((x) => ({
          key: String(x.id), label: x.name ?? `Product ${x.id}`,
          sub: [x.brand, x.subcategory, x.size, x.aliases > 1 ? `${x.aliases} listing names` : null].filter(Boolean).join(" · "),
          href: `/insights/product/${x.id}${withQuery(query)}`,
          reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
        }))}
        exportKind="products"
        query={query}
        loading={p.loading}
        error={p.error}
      />
      {p.data && <MethodPanel items={[{ label: "Intelligence Score", text: p.data.method.formula }, { label: "Trust weight", text: p.data.method.trustWeight }]} />}
    </div>
  );
}

function BrandsView({ query }: { query: string }) {
  const b = useJson<Brands>(`/api/aggregates/brands${withQuery(query)}`);
  return (
    <div className="space-y-3">
      <RankingTable
        title="Brands"
        subtitle={b.data ? `${num(b.data.brands.length)} brands. Scores shrink toward ${b.data.prior ?? "–"}, the score of everything in the filter.` : undefined}
        nameLabel="Brand"
        rows={(b.data?.brands ?? []).map((x) => ({
          key: String(x.brand), label: String(x.brand ?? "Unknown"), sub: `${num(x.products)} products`,
          href: drillHref(query, { brand: String(x.brand) }, "/insights/brand"),
          reviews: x.reviews, averageRating: x.averageRating, negativeShare: x.negativeShare, intelligenceScore: x.intelligenceScore,
        }))}
        exportKind="brands"
        query={query}
        loading={b.loading}
        error={b.error}
      />
      {b.data && <MethodPanel items={[{ label: "Intelligence Score", text: b.data.method.formula }, { label: "Trust weight", text: b.data.method.trustWeight }]} />}
    </div>
  );
}
