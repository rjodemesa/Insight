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
 * One filter bar above everything it scopes. With `collapsible` it is a single slim row
 * (Filters button with a count, date presets, search, saved views) that opens the full set. Every control writes to the URL; every
 * chart and table on the page reads from it. Values come from the data, never hard-coded.
 */
const PRESETS: [number, string][] = [[30, "30 days"], [90, "90 days"], [365, "12 months"]];
const OPEN_KEY = "prism.filtersOpen";

export default function FilterBar({ collapsible = false }: { collapsible?: boolean }) {
  const f = useFilters();
  // A collapsible bar remembers whether this browser last left it open.
  const [open, setOpen] = useState(!collapsible);
  useEffect(() => {
    if (!collapsible) return;
    try {
      if (window.localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {
      // Storage unavailable: stay collapsed.
    }
  }, [collapsible]);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, which is fine.
    }
  };
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

  const activeCount = [...new URLSearchParams(f.query).keys()].length;
  const from = f.get("from");
  const to = f.get("to");
  const activePreset: number | "all" | null = !from && !to ? "all"
    : maxDate && !to ? PRESETS.find(([d]) => from === daysBefore(maxDate, d - 1))?.[0] ?? null : null;
  const seg = (active: boolean) => `px-2.5 py-1 ${active ? "bg-brand text-white" : "bg-surface hover:bg-brand-soft"}`;

  return (
    <section aria-label="Filters" className="space-y-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {collapsible && (
          <button type="button" onClick={() => toggle(!open)} aria-expanded={open} aria-controls="filter-panel"
            className={`flex items-center gap-1.5 rounded border px-3 py-1 font-medium hover:bg-brand-soft ${open || activeCount ? "border-brand text-brand" : "border-line"}`}>
            Filters
            {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{activeCount}</span>}
            <span aria-hidden="true" className="text-xs">{open ? "▴" : "▾"}</span>
          </button>
        )}
        <div role="group" aria-label="Date range" className="flex divide-x divide-line overflow-hidden rounded border border-line"
          title={maxDate ? `Relative to the latest review, ${day(maxDate)}` : undefined}>
          {PRESETS.map(([d, l]) => (
            <button key={l} type="button" onClick={() => preset(d)} disabled={!maxDate} aria-pressed={activePreset === d} className={seg(activePreset === d)}>{l}</button>
          ))}
          <button type="button" onClick={() => f.update({ from: null, to: null })} aria-pressed={activePreset === "all"} className={seg(activePreset === "all")}>All time</button>
        </div>
        {activePreset === null && <span className="text-xs text-ink-muted">Custom dates</span>}

        <form role="search" className="flex items-center" onSubmit={(e) => { e.preventDefault(); f.set("q", q.trim() || null); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search review text" aria-label="Search review text"
            className="w-44 rounded-l border border-line px-2 py-1 sm:w-52" />
          <button type="submit" className="rounded-r border border-brand bg-brand px-2.5 py-1 text-white">Search</button>
        </form>

        <div className="ml-auto">
          <SavedViews />
        </div>
      </div>

      {open && (
        <div id="filter-panel" className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
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
            <select value={f.get("minRating") ?? ""} onChange={(e) => f.set("minRating", e.target.value || null)} aria-label="Minimum rating"
              className="rounded border border-line bg-surface px-1 py-1.5">
              <option value="">any</option>
              {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>≥ {r}★</option>)}
            </select>
            <select value={f.get("maxRating") ?? ""} onChange={(e) => f.set("maxRating", e.target.value || null)} aria-label="Maximum rating"
              className="rounded border border-line bg-surface px-1 py-1.5">
              <option value="">any</option>
              {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>≤ {r}★</option>)}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={f.get("verified") === "true"} onChange={(e) => f.set("verified", e.target.checked ? "true" : null)} />
            Verified purchases only
          </label>

          <span className="flex items-center gap-1 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-ink-muted">From</span>
              <input type="date" value={from ?? ""} min={opts?.dateRange.from ?? undefined} max={maxDate ?? undefined}
                onChange={(e) => f.set("from", e.target.value || null)} className="rounded border border-line px-1 py-1" />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-ink-muted">to</span>
              <input type="date" value={to ?? ""} min={opts?.dateRange.from ?? undefined} max={maxDate ?? undefined}
                onChange={(e) => f.set("to", e.target.value || null)} className="rounded border border-line px-1 py-1" />
            </label>
          </span>
        </div>
      )}

      <ActiveFilters opts={opts} quiet={collapsible} />
      {opts && opts.staleReviews > 0 && (
        <p className="text-xs text-negative">
          {num(opts.staleReviews)} reviews were tagged with an older taxonomy or lexicon. Stop the server and run <code>npm run reprocess</code>.
        </p>
      )}
    </section>
  );
}

/** Removable chips for every active filter, plus "Clear all". */
function ActiveFilters({ opts, quiet = false }: { opts: FilterOptions | null; quiet?: boolean }) {
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
      : key === "hasText" ? (value === "true" ? "with comments" : "without comments")
      : key === "hasPhotos" ? (value === "true" ? "with photos" : "without photos")
      : value;
    chips.push({ key, value, label });
  }
  if (!chips.length) return quiet ? null : <p className="text-xs text-ink-muted">Showing all reviews (duplicates excluded).</p>;
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
