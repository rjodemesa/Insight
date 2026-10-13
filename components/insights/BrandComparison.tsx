"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { brandComparison } from "@/lib/insights/ratings";
import Card from "@/components/ui/Card";
import MethodPanel from "@/components/ui/MethodPanel";
import { drillHref, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import { num, pct } from "@/components/ui/format";

type Data = ReturnType<typeof brandComparison>;
type Brand = Data["brands"][number];
type SortKey = "reviews" | "averageRating" | "lowRatingShare" | "gapToRest";

const STAR_COLORS: Record<number, string> = { 5: "#1c5cab", 4: "#7fb0ea", 3: "#c9c7c1", 2: "#f0a3a2", 1: "#e34948" };
const VERDICT: Record<Brand["verdict"], { label: string; cls: string }> = {
  over: { label: "Overperformer", cls: "bg-positive text-white" },
  under: { label: "Underperformer", cls: "bg-negative text-white" },
  in_line: { label: "In line", cls: "bg-canvas text-ink-muted" },
  too_few: { label: "Too few ratings", cls: "border border-line text-ink-muted" },
};
const unbranded = (b: string) => /^\W*no\s*brand\w*\W*$/i.test(b) || b === "Unknown";
const gap = (g: number | null) => (g === null ? "–" : `${g > 0 ? "+" : ""}${g.toFixed(2)}★`);

function StarMix({ b }: { b: Brand }) {
  const total = Object.values(b.stars).reduce((a, n) => a + n, 0);
  if (!total) return <span className="text-xs text-ink-muted">no ratings</span>;
  return (
    <span className="flex h-3 w-32 overflow-hidden rounded" title={[5, 4, 3, 2, 1].map((s) => `${s}★ ${num(b.stars[s as 5])}`).join(" · ")}>
      {[5, 4, 3, 2, 1].map((s) => {
        const n = b.stars[s as 5];
        return n ? <span key={s} style={{ width: `${(n / total) * 100}%`, backgroundColor: STAR_COLORS[s] }} /> : null;
      })}
    </span>
  );
}

/**
 * Every brand as one portfolio: share of reviews (visibility), star ratings, and which
 * brands rate significantly above or below the rest. Follows the page filters.
 */
export default function BrandComparison({ query }: { query: string }) {
  const { data, loading, error } = useJson<Data>(`/api/aggregates/brand-comparison${withQuery(query)}`);
  const [sort, setSort] = useState<SortKey>("reviews");
  const [all, setAll] = useState(false);

  const sorted = useMemo(() => {
    const list = [...(data?.brands ?? [])];
    const val = (b: Brand) => (b[sort] ?? (sort === "lowRatingShare" ? -1 : -99)) as number;
    return list.sort((a, b) => val(b) - val(a));
  }, [data, sort]);
  const over = (data?.brands ?? []).filter((b) => b.verdict === "over").sort((a, b) => (b.gapToRest ?? 0) - (a.gapToRest ?? 0));
  const under = (data?.brands ?? []).filter((b) => b.verdict === "under").sort((a, b) => (a.gapToRest ?? 0) - (b.gapToRest ?? 0));
  const top = (data?.brands ?? []).slice(0, 12);
  const otherShare = data ? Math.max(0, 1 - top.reduce((a, b) => a + (b.visibility ?? 0), 0)) : 0;
  const maxVis = Math.max(0.0001, ...top.map((b) => b.visibility ?? 0), otherShare);
  const brandLink = (b: string) => drillHref(query, { brand: b }, "/insights/brand");

  const sortBtn = (k: SortKey, label: string) => (
    <button type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={sort === k ? "font-semibold text-brand" : "underline decoration-dotted"}>{label}</button>
  );
  const performer = (b: Brand) => (
    <li key={b.brand} className="flex items-baseline gap-2">
      <Link href={brandLink(b.brand)} className="font-medium text-brand underline">{b.brand}</Link>
      <span className="tabular-nums">{b.averageRating?.toFixed(2)}★</span>
      <span className="text-xs text-ink-muted">{gap(b.gapToRest)} vs the rest · {num(b.rated)} ratings · {pct(b.visibility, 1)} of reviews</span>
    </li>
  );

  return (
    <div className="space-y-4">
      <Card title="Brand comparison: reviews and ratings" provenance="DERIVED" loading={loading} error={error}
        subtitle="All brands treated as one portfolio. Visibility is each brand's share of all reviews under the current filters.">
        {data && (
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              ["Reviews", num(data.totalReviews)],
              ["Brands", num(data.brands.length)],
              ["Portfolio average", `${data.averageRating?.toFixed(2) ?? "–"}★`],
              ["Rated 1–2★", pct(data.lowRatingShare)],
            ].map(([k, v]) => (
              <div key={k} className="rounded border border-line p-3">
                <p className="text-xs text-ink-muted">{k}</p>
                <p className="text-xl font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Overperformers" subtitle={`Rated significantly higher than the rest, by at least 0.05★.`}
            empty={!over.length ? "No brand rates significantly above the rest under these filters." : null}>
            <ul className="space-y-1 text-sm">{over.map(performer)}</ul>
          </Card>
          <Card title="Underperformers" subtitle={`Rated significantly lower than the rest, by at least 0.05★.`}
            empty={!under.length ? "No brand rates significantly below the rest under these filters." : null}>
            <ul className="space-y-1 text-sm">{under.map(performer)}</ul>
          </Card>
        </div>
      )}

      {data && (
        <Card title="Visibility: share of reviews" provenance="DERIVED" subtitle="The 12 most-reviewed brands; every other brand is grouped.">
          <ul className="space-y-1 text-sm">
            {[...top.map((b) => ({ key: b.brand, label: b.brand, v: b.visibility ?? 0, n: b.reviews })), { key: "_other", label: `All other ${num(Math.max(0, data.brands.length - top.length))} brands`, v: otherShare, n: data.totalReviews - top.reduce((a, b) => a + b.reviews, 0) }].map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <span className="w-44 truncate" title={r.label}>
                  {r.label}{unbranded(r.label) && <span className="text-xs text-ink-muted"> (no brand stated)</span>}
                </span>
                <span className="h-4 flex-1 overflow-hidden rounded bg-canvas">
                  <span className={`block h-full rounded ${r.key === "_other" ? "bg-[#c9c7c1]" : "bg-brand"}`} style={{ width: `${(r.v / maxVis) * 100}%` }} />
                </span>
                <span className="w-28 text-right tabular-nums">{pct(r.v, 1)} <span className="text-xs text-ink-muted">({num(r.n)})</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && (
        <Card title="All brands" subtitle={<>Sort by {sortBtn("reviews", "reviews")}, {sortBtn("averageRating", "average rating")}, {sortBtn("gapToRest", "gap to the rest")} or {sortBtn("lowRatingShare", "1–2★ share")}.</>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Brand</th>
                  <th className="py-1 pr-3 text-right font-medium">Reviews</th>
                  <th className="py-1 pr-3 text-right font-medium">Visibility</th>
                  <th className="py-1 pr-3 text-right font-medium">Avg rating</th>
                  <th className="py-1 pr-3 font-medium">Star mix (5★ → 1★)</th>
                  <th className="py-1 pr-3 text-right font-medium">1–2★</th>
                  <th className="py-1 pr-3 text-right font-medium">vs rest</th>
                  <th className="py-1 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(all ? sorted : sorted.slice(0, 20)).map((b) => (
                  <tr key={b.brand}>
                    <td className="py-1.5 pr-3">
                      <Link href={brandLink(b.brand)} className="text-brand underline">{b.brand}</Link>
                      {unbranded(b.brand) && <span className="block text-xs text-ink-muted">no brand stated on the listing</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{num(b.reviews)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(b.visibility, 1)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{b.averageRating?.toFixed(2) ?? "–"}</td>
                    <td className="py-1.5 pr-3"><StarMix b={b} /></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{pct(b.lowRatingShare)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{gap(b.gapToRest)}</td>
                    <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-xs ${VERDICT[b.verdict].cls}`}>{VERDICT[b.verdict].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 20 && (
            <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm text-brand underline">
              {all ? "Show the top 20" : `Show all ${num(sorted.length)} brands`}
            </button>
          )}
        </Card>
      )}

      {data && <MethodPanel items={[{ label: "Visibility", text: data.method.visibility }, { label: "Over- and underperformers", text: data.method.verdict }]} />}
    </div>
  );
}
