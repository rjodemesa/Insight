"use client";

import Link from "next/link";
import { useState } from "react";
import type { queue, recentVerifications, reliabilityBands } from "@/lib/verify";
import Card from "@/components/ui/Card";
import FilterBar from "@/components/filters/FilterBar";
import RatingFilter from "@/components/filters/RatingFilter";
import { useFilters, withQuery } from "@/components/filters/useFilters";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { day, manila, num, pct } from "@/components/ui/format";
import { reviewHref } from "@/components/ai/Cited";

type Queue = ReturnType<typeof queue>;
type Overview = { reliability: ReturnType<typeof reliabilityBands>; recent: ReturnType<typeof recentVerifications> };

const PAGE = 20;
const REASON: Record<string, { label: string; hint: string }> = {
  stars_disagree: { label: "Stars disagree with text", hint: "The star rating and the wording point in opposite directions." },
  mixed: { label: "Mixed or weak wording", hint: "It has sentiment words, but they cancel out or are very mild." },
  unreadable: { label: "Couldn't read", hint: "The tagger found no sentiment words, so it guessed neutral." },
  low_confidence: { label: "Low confidence", hint: "Few sentiment words to go on." },
};
const VERDICTS = [
  { v: "positive", label: "Positive", cls: "border-[#2a78d6] text-[#1c5cab]" },
  { v: "neutral", label: "Neutral", cls: "border-line text-ink" },
  { v: "negative", label: "Negative", cls: "border-negative text-negative" },
  { v: "unreadable", label: "Unreadable / spam", cls: "border-line text-ink-muted" },
] as const;
const PRESETS = [
  { key: "recommended", label: "Truly uncertain (recommended)", threshold: "0.31", mixed: "true", conflict: "true", hint: "Couldn't read, mixed wording, or stars disagree" },
  { key: "unreadable", label: "Couldn't read only", threshold: "0.31", mixed: null, conflict: null, hint: "No sentiment words found" },
  { key: "75", label: "Everything below 75%", threshold: "0.75", mixed: null, conflict: null, hint: "Includes many short, clear reviews like \"ok\"" },
] as const;

const contradictStyle = (x: number) => (x >= 0.15 ? "bg-negative text-white" : x >= 0.05 ? "bg-[#c98500] text-white" : "bg-positive text-white");

/**
 * Manual verification of reviews the tagger is unsure about. A verdict replaces the
 * automatic label in every chart, export and AI answer, survives reprocessing, and can be undone.
 */
export default function VerifyQueue() {
  const api = useApi();
  const f = useFilters();
  const threshold = f.get("threshold") ?? "0.31";
  const mixed = (f.get("mixed") ?? "true") === "true";
  // "disagree", not "conflict": that name is the global rating/text conflict filter.
  const conflict = (f.get("disagree") ?? "true") === "true";
  const sort = f.get("sort") ?? "uncertain";
  const offset = Math.max(0, Number(f.get("offset") ?? 0) || 0);
  const params = [f.query, `threshold=${threshold}`, `mixed=${mixed}`, `disagree=${conflict}`, `sort=${sort}`, `limit=${PAGE}`, `offset=${offset}`].filter(Boolean).join("&");
  const q = useJson<Queue>(`/api/verify?${params}`);
  const overview = useJson<Overview>(`/api/verify/overview${withQuery(f.query)}`);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ id: number; verdict: string } | null>(null);

  const t = threshold === "off" ? null : Number(threshold);
  const preset = PRESETS.find((p) => p.threshold === threshold && (p.mixed === "true") === mixed && (p.conflict === "true") === conflict)?.key;
  const bands = overview.data?.reliability.bands ?? [];
  const maxBand = Math.max(1, ...bands.map((b) => b.reviews));
  const below = t === null ? 0 : bands.filter((b) => b.confidence < t).reduce((a, b) => a + b.reviews, 0);
  const tagged = overview.data?.reliability.total ?? 0;

  async function decide(id: number, verdict: string) {
    setBusy(id);
    setError(null);
    try {
      await api("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: id, verdict }) });
      setLast({ id, verdict });
      void q.reload();
      void overview.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function undo(id: number) {
    setError(null);
    try {
      await api(`/api/verify/${id}`, { method: "DELETE" });
      if (last?.id === id) setLast(null);
      void q.reload();
      void overview.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const d = q.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Check the reviews the automatic tagger is unsure about. Your answer replaces its label in every chart, export and AI answer,
        is kept when the data is re-tagged, and can be undone.
      </p>
      <FilterBar />
      <RatingFilter />

      <Card title="How reliable is the automatic label?" provenance="DERIVED" loading={overview.loading && !overview.data} error={overview.error}
        subtitle={overview.data?.reliability.method}>
        {bands.length > 0 && (
          <div className="space-y-3">
            <ul className="space-y-1 text-xs" aria-label="Reviews by confidence band">
              {bands.map((b) => {
                const inQueue = t !== null && b.confidence < t;
                return (
                  <li key={b.confidence} className={`flex items-center gap-2 rounded px-1 ${inQueue ? "bg-brand-soft" : ""}`}>
                    <span className="w-10 text-right tabular-nums">{Math.round(b.confidence * 100)}%</span>
                    <span className="h-3 flex-1 overflow-hidden rounded bg-canvas">
                      <span className="block h-full rounded bg-brand/70" style={{ width: `${(b.reviews / maxBand) * 100}%` }} />
                    </span>
                    <span className="w-16 text-right tabular-nums text-ink-muted">{num(b.reviews)}</span>
                    <span className={`w-28 rounded px-1.5 text-center tabular-nums ${contradictStyle(b.contradictShare)}`} title="Share whose label contradicts the star rating">
                      {pct(b.contradictShare)} contradict
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm">
              {t === null ? "The confidence threshold is off." : (
                <>Below <strong>{Math.round(t * 100)}%</strong>: <strong>{num(below)}</strong> reviews ({pct(tagged ? below / tagged : null)} of reviews with text, highlighted).</>
              )}{" "}
              <span className="text-ink-muted">
                The 30% band is reviews with no sentiment words; most are short praise the word lists don&apos;t know yet, plus spam and gibberish.
                Mistakes cluster where wording is mixed, which can happen at any confidence, so &ldquo;Mixed or weak wording&rdquo; catches what a threshold misses.
              </span>
            </p>
          </div>
        )}
      </Card>

      <Card title="What to check">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" title={p.hint} aria-pressed={preset === p.key}
                onClick={() => f.update({ threshold: p.threshold, mixed: p.mixed ?? "false", disagree: p.conflict ?? "false" })}
                className={`rounded border px-3 py-1 ${preset === p.key ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:border-brand"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={t !== null} onChange={(e) => f.update({ threshold: e.target.checked ? "0.75" : "off" })} />
              Confidence below
              <input type="range" min={30} max={95} step={5} disabled={t === null} aria-label="Confidence threshold"
                value={t === null ? 75 : Math.max(30, Math.round(t * 100))}
                onChange={(e) => f.update({ threshold: Number(e.target.value) <= 30 ? "0.31" : String(Number(e.target.value) / 100) })} />
              <span className="w-10 tabular-nums font-medium">{t === null ? "off" : t <= 0.31 ? "30%" : `${Math.round(t * 100)}%`}</span>
              {d && t !== null && <span className="text-xs text-ink-muted">({num(d.counts.belowThreshold)})</span>}
            </label>
            <label className="flex items-center gap-2" title={REASON.mixed!.hint}>
              <input type="checkbox" checked={mixed} onChange={(e) => f.update({ mixed: String(e.target.checked) })} />
              Mixed or weak wording {d && <span className="text-xs text-ink-muted">({num(d.counts.mixed)})</span>}
            </label>
            <label className="flex items-center gap-2" title={REASON.stars_disagree!.hint}>
              <input type="checkbox" checked={conflict} onChange={(e) => f.update({ disagree: String(e.target.checked) })} />
              Stars disagree with text {d && <span className="text-xs text-ink-muted">({num(d.counts.conflict)})</span>}
            </label>
            <label className="ml-auto flex items-center gap-1 text-xs">
              Order
              <select value={sort} onChange={(e) => f.update({ sort: e.target.value })} className="rounded border border-line px-1 py-0.5">
                <option value="uncertain">Most uncertain first</option>
                <option value="newest">Newest</option>
                <option value="rating_low">Lowest rating</option>
                <option value="rating_high">Highest rating</option>
              </select>
            </label>
          </div>
          {d && (
            <p className="text-xs text-ink-muted">
              {num(d.total)} reviews to check · {num(d.counts.verified)} verified so far
              {d.counts.withText ? ` · ${pct(d.total / d.counts.withText)} of unverified reviews with text` : ""}
            </p>
          )}
        </div>
      </Card>

      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      {last && (
        <p role="status" className="flex items-center gap-3 rounded border border-line bg-surface px-3 py-2 text-sm">
          Review {last.id} marked {last.verdict}.
          <button type="button" onClick={() => void undo(last.id)} className="text-brand underline">Undo</button>
        </p>
      )}

      <Card title="Reviews to check" loading={q.loading} error={q.error}
        empty={d && !d.total ? "Nothing to check for these settings. Widen the threshold or clear some filters." : null}>
        {d && (
          <>
            <ol className="divide-y divide-line">
              {d.reviews.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    <span aria-label={`${r.rating ?? "no"} stars`} className="text-[#f5a623]">{r.rating ? "★".repeat(r.rating) : "no rating"}</span>
                    <span>{day(r.date)}</span>
                    {r.brand && <span>· {r.brand}</span>}
                    {(r.product ?? r.listingName) && <span className="truncate">· {r.product ?? r.listingName}</span>}
                    <Link href={reviewHref(r.id)} className="ml-auto text-brand underline">Open</Link>
                  </div>
                  {r.title && <p className="mt-1 font-medium">{r.title}</p>}
                  <p className="mt-0.5 whitespace-pre-line text-sm">{r.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full border border-line px-2 py-0.5">
                      Tagger says <strong>{r.sentiment}</strong> · {Math.round((r.confidence ?? 0) * 100)}% confident
                    </span>
                    {r.reasons.map((x) => (
                      <span key={x} title={REASON[x]?.hint} className="rounded-full bg-[#fff4e5] px-2 py-0.5 text-[#8a4b00]">{REASON[x]?.label ?? x}</span>
                    ))}
                    {r.themes.map((th) => <span key={th.theme} className="rounded-full bg-canvas px-2 py-0.5">{th.label}</span>)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Verdict for review ${r.id}`}>
                    <span className="text-xs text-ink-muted">Actually:</span>
                    {VERDICTS.map((v) => (
                      <button key={v.v} type="button" disabled={busy === r.id} onClick={() => void decide(r.id, v.v)}
                        className={`rounded border bg-surface px-3 py-1 text-sm hover:bg-canvas disabled:opacity-50 ${v.cls} ${r.sentiment === v.v ? "font-semibold" : ""}`}>
                        {v.label}{r.sentiment === v.v ? " ✓" : ""}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            {d.total > PAGE && (
              <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
                <button type="button" disabled={offset === 0} onClick={() => f.set("offset", String(Math.max(0, offset - PAGE)))} className="rounded border border-line px-3 py-1 disabled:opacity-40">← Previous</button>
                <span className="text-ink-muted">{num(offset + 1)}–{num(Math.min(offset + PAGE, d.total))} of {num(d.total)}</span>
                <button type="button" disabled={offset + PAGE >= d.total} onClick={() => f.set("offset", String(offset + PAGE))} className="rounded border border-line px-3 py-1 disabled:opacity-40">Next →</button>
              </nav>
            )}
          </>
        )}
      </Card>

      {overview.data && overview.data.recent.length > 0 && (
        <Card title="Recently verified" subtitle="The latest verdicts by anyone. Undo puts the automatic label back.">
          <ul className="divide-y divide-line text-sm">
            {overview.data.recent.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Link href={reviewHref(v.id)} className="text-brand underline">#{v.id}</Link>
                <span className="font-medium">{v.unclear ? "unreadable" : v.sentiment}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{v.text}</span>
                <span className="text-xs text-ink-muted">{v.verifiedBy ?? "–"} · {manila(v.verifiedAt)}</span>
                <button type="button" onClick={() => void undo(v.id)} className="text-xs text-brand underline">Undo</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
