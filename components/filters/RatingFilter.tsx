"use client";

import type { ratingSummary } from "@/lib/insights/ratings";
import { useJson } from "@/components/ui/useJson";
import { compact, num, pct } from "@/components/ui/format";
import { useFilters, withQuery } from "./useFilters";

type Summary = ReturnType<typeof ratingSummary>;

/**
 * Rating summary and star filter in the style of Lazada and Shopee: the average, a bar per
 * star, and one-tap chips (All, 5★…1★, With comments, With photos). Writes the usual
 * minRating/maxRating/hasText/hasPhotos filters to the URL, so every panel below follows.
 */
export default function RatingFilter({ showSummary = true }: { showSummary?: boolean }) {
  const f = useFilters();
  // Counts ignore the star/comments/photos filters themselves, so the chips stay comparable.
  const { data } = useJson<Summary>(`/api/aggregates/ratings${withQuery(f.query)}`);
  const min = f.get("minRating");
  const max = f.get("maxRating");
  const star = min && min === max ? Number(min) : null;
  const custom = (min || max) && star === null;
  const hasText = f.get("hasText") === "true";
  const hasPhotos = f.get("hasPhotos") === "true";

  const pickStar = (s: number | null) => f.update({ minRating: s === null ? null : String(s), maxRating: s === null ? null : String(s) });

  const chip = (active: boolean) =>
    `rounded border px-3 py-1 text-sm ${active ? "border-brand bg-brand-soft font-medium text-brand" : "border-line bg-surface hover:border-brand"}`;

  return (
    <section aria-label="Filter by rating" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      {showSummary && data && (
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-center">
            <p className="text-4xl font-semibold leading-none">{data.averageRating?.toFixed(1) ?? "–"}<span className="text-base text-ink-muted"> /5</span></p>
            <p aria-hidden="true" className="mt-1 text-lg tracking-wider text-[#f5a623]">{"★".repeat(Math.round(data.averageRating ?? 0))}<span className="text-line">{"★".repeat(5 - Math.round(data.averageRating ?? 0))}</span></p>
            <p className="text-xs text-ink-muted">{num(data.rated)} ratings{data.noRating ? ` · ${num(data.noRating)} without` : ""}</p>
          </div>
          <ul className="min-w-56 flex-1 space-y-0.5 text-xs" aria-label="Ratings by star">
            {data.stars.map((s) => (
              <li key={s.star} className="flex items-center gap-2">
                <span className="w-6 text-right">{s.star}★</span>
                <span className="h-2 flex-1 overflow-hidden rounded bg-canvas">
                  <span className="block h-full rounded bg-[#f5a623]" style={{ width: `${(s.share ?? 0) * 100}%` }} />
                </span>
                <span className="w-24 tabular-nums text-ink-muted">{num(s.reviews)} ({pct(s.share)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show reviews with">
        <button type="button" aria-pressed={star === null && !custom} onClick={() => pickStar(null)} className={chip(star === null && !custom)}>
          All{data ? ` (${compact(data.total)})` : ""}
        </button>
        {[5, 4, 3, 2, 1].map((s) => {
          const n = data?.stars.find((x) => x.star === s)?.reviews;
          return (
            <button key={s} type="button" aria-pressed={star === s} onClick={() => pickStar(star === s ? null : s)} className={chip(star === s)}>
              {s} Star{n !== undefined ? ` (${compact(n)})` : ""}
            </button>
          );
        })}
        <button type="button" aria-pressed={hasText} onClick={() => f.set("hasText", hasText ? null : "true")} className={chip(hasText)}>
          With comments{data ? ` (${compact(data.withText)})` : ""}
        </button>
        <button type="button" aria-pressed={hasPhotos} onClick={() => f.set("hasPhotos", hasPhotos ? null : "true")} className={chip(hasPhotos)}>
          With photos{data ? ` (${compact(data.withPhotos)})` : ""}
        </button>
        {custom && <span className="self-center text-xs text-ink-muted">Custom range {min || 1}–{max || 5}★ from the filters above</span>}
      </div>
    </section>
  );
}
