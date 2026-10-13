"use client";

import { useEffect, useState } from "react";
import type { filterOptions } from "@/lib/insights/queries";
import { useJson } from "@/components/ui/useJson";
import { day, num } from "@/components/ui/format";
import MultiSelect, { type Option } from "./MultiSelect";
import SavedViews from "./SavedViews";
import { useFilters } from "./useFilters";

export type FilterOptions = ReturnType<typeof filterOptions>;

const LANGUAGE_LABELS: Record<string, string> = {
  english: "English", filipino: "Filipino", taglish: "Taglish", emoji_only: "Emoji only", empty: "No text", other: "Other",
};
const SENTIMENT_LABELS: Record<string, string> = { positive: "Positive", neutral: "Neutral", negative: "Negative", none: "Not tagged (no text)" };
const daysBefore = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

/**
 * One filter row above everything it scopes. Every control writes to the URL; every
 * chart and table on the page reads from it. Values come from the data, never hard-coded.
 */
export default function FilterBar() {
  const f = useFilters();
  const { data: opts } = useJson<FilterOptions>("/api/aggregates/filters");
  const qParam = f.get("q") ?? "";
  const [q, setQ] = useState(qParam);
  useEffect(() => setQ(qParam), [qParam]);

  const values = (list: { value: unknown; reviews: unknown }[] | undefined, labels?: Record<string, string>): Option[] =>
    (list ?? []).map((o) => ({ value: String(o.value), label: labels?.[String(o.value)] ?? String(o.value), count: Number(o.reviews) }));
  const themeOptions: Option[] = (opts?.themes ?? [])
    .slice()
    .sort((a, b) => a.vector.localeCompare(b.vector) || a.label.localeCompare(b.label))
    .map((t) => ({ value: t.id, label: t.label, group: t.vector }));
  const multi = (key: string, label: string, options: Option[]) => (
    <MultiSelect key={key} label={label} options={options} selected={f.getAll(key)} onChange={(v) => f.set(key, v)} />
  );

  const maxDate = opts?.dateRange.to ?? null;
  const preset = (days: number | null) => {
    if (days === null || !maxDate) {
      f.set("from", null);
      return;
    }
    f.set("from", daysBefore(maxDate, days - 1));
  };

  return (
    <section aria-label="Filters" className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {multi("retailer", "Retailer", values(opts?.retailers))}
        {multi("category", "Category", values(opts?.categories))}
        {multi("subcategory", "Subcategory", values(opts?.subcategories))}
        {multi("brand", "Brand", values(opts?.brands))}
        {multi("sentiment", "Sentiment", (opts?.sentiments ?? []).map((s) => ({ value: s, label: SENTIMENT_LABELS[s] ?? s })))}
        {multi("vector", "Vector", (opts?.vectors ?? []).map((v) => ({ value: v, label: v })))}
        {multi("theme", "Theme", themeOptions)}
        {multi("language", "Language", values(opts?.languages, LANGUAGE_LABELS))}

        <label className="flex items-center gap-1 text-sm">
          <span className="text-ink-muted">Rating</span>
          <select
            value={f.get("minRating") ?? ""}
            onChange={(e) => f.set("minRating", e.target.value || null)}
            aria-label="Minimum rating"
            className="rounded border border-line bg-surface px-1 py-1.5"
          >
            <option value="">any</option>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>≥ {r}★</option>)}
          </select>
          <select
            value={f.get("maxRating") ?? ""}
            onChange={(e) => f.set("maxRating", e.target.value || null)}
            aria-label="Maximum rating"
            className="rounded border border-line bg-surface px-1 py-1.5"
          >
            <option value="">any</option>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>≤ {r}★</option>)}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={f.get("verified") === "true"} onChange={(e) => f.set("verified", e.target.checked ? "true" : null)} />
          Verified only
        </label>

        <div className="ml-auto">
          <SavedViews />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-ink-muted">From</span>
          <input type="date" value={f.get("from") ?? ""} min={opts?.dateRange.from ?? undefined} max={maxDate ?? undefined}
            onChange={(e) => f.set("from", e.target.value || null)} className="rounded border border-line px-1 py-1" />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-ink-muted">To</span>
          <input type="date" value={f.get("to") ?? ""} min={opts?.dateRange.from ?? undefined} max={maxDate ?? undefined}
            onChange={(e) => f.set("to", e.target.value || null)} className="rounded border border-line px-1 py-1" />
        </label>
        <span className="text-ink-muted" title={maxDate ? `Relative to the latest review, ${day(maxDate)}` : undefined}>Last</span>
        {[[30, "30 days"], [90, "90 days"], [365, "12 months"]].map(([d, l]) => (
          <button key={l} type="button" onClick={() => preset(d as number)} disabled={!maxDate}
            className="rounded border border-line px-2 py-1 hover:bg-canvas">{l}</button>
        ))}
        <button type="button" onClick={() => { f.set("from", null); }} className="rounded border border-line px-2 py-1 hover:bg-canvas">
          All time
        </button>

        <form
          role="search"
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            f.set("q", q.trim() || null);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search review text" aria-label="Search review text"
            className="w-56 rounded border border-line px-2 py-1" />
          <button type="submit" className="rounded bg-brand px-3 py-1 text-white">Search</button>
        </form>
      </div>

      <ActiveFilters opts={opts} />
      {opts && opts.staleReviews > 0 && (
        <p className="text-xs text-negative">
          {num(opts.staleReviews)} reviews were tagged with an older taxonomy or lexicon. Stop the server and run <code>npm run reprocess</code>.
        </p>
      )}
    </section>
  );
}

/** Removable chips for every active filter, plus "Clear all". */
function ActiveFilters({ opts }: { opts: FilterOptions | null }) {
  const f = useFilters();
  const chips: { key: string; value: string; label: string }[] = [];
  const theme = (id: string) => opts?.themes.find((t) => t.id === id)?.label ?? id;
  for (const [key, value] of new URLSearchParams(f.query)) {
    const label =
      key === "theme" ? theme(value)
      : key === "sentiment" ? SENTIMENT_LABELS[value] ?? value
      : key === "language" ? LANGUAGE_LABELS[value] ?? value
      : key === "minRating" ? `rating ≥ ${value}`
      : key === "maxRating" ? `rating ≤ ${value}`
      : key === "verified" ? (value === "true" ? "verified only" : "not verified")
      : key === "conflict" ? (value === "true" ? "rating disagrees with text" : "no rating conflict")
      : key === "themeSentiment" ? `theme is ${value}`
      : key === "from" ? `from ${day(value)}`
      : key === "to" ? `to ${day(value)}`
      : key === "q" ? `“${value}”`
      : key === "product" ? `product #${value}`
      : key === "review" ? `review #${value}`
      : key === "includeDuplicates" ? "including duplicates"
      : value;
    chips.push({ key, value, label });
  }
  if (!chips.length) return <p className="text-xs text-ink-muted">Showing all reviews (duplicates excluded).</p>;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={`${c.key}=${c.value}`}>
          <button
            type="button"
            onClick={() => f.set(c.key, f.getAll(c.key).filter((v) => v !== c.value))}
            aria-label={`Remove filter ${c.label}`}
            className="rounded-full border border-brand bg-brand-soft px-2 py-0.5 text-xs"
          >
            {c.label} <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={f.clear} className="text-xs text-brand underline">Clear all</button>
      </li>
    </ul>
  );
}
