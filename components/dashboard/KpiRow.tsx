"use client";

import { useState } from "react";
import type { summary } from "@/lib/insights/queries";
import type { operations } from "@/lib/insights/operations";
import { hoursSaved } from "@/lib/insights/derive";
import { useApi } from "@/components/SessionContext";
import StatTile from "@/components/ui/StatTile";
import { duration, num, pct } from "@/components/ui/format";
import { drillHref } from "@/components/filters/useFilters";

type Summary = ReturnType<typeof summary>;
type Ops = ReturnType<typeof operations>;

/** Headline numbers for the filtered reviews, plus pipeline facts and the hours-saved estimate. */
export default function KpiRow({ s, ops, query, onOpsChange }: { s: Summary | null; ops: Ops | null; query: string; onOpsChange: () => void }) {
  const reviewsHref = drillHref(query, { view: "reviews" });
  const minutes = ops?.estimates.minutesPerRecord ?? null;
  const hours = s && minutes !== null ? hoursSaved(s.reviews, minutes, ops?.latestImport?.durationMs ?? null) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatTile label="Reviews" icon="▤" provenance="OBSERVED" value={num(s?.reviews)} href={reviewsHref}
        note={s ? `${num(s.withText)} with text` : undefined} />
      <StatTile label="Products" icon="▣" provenance="DERIVED" value={num(s?.products)} href={drillHref(query, { view: "products" })}
        note={s ? `${num(s.brands)} brands · ${num(s.retailers)} retailers` : undefined} />
      <StatTile label="Average rating" icon="★" provenance="OBSERVED" value={s?.averageRating?.toFixed(2) ?? "–"} unit={s?.averageRating ? "/5" : undefined}
        note={s?.averageRating ? <Stars rating={s.averageRating} /> : "out of 5"} />
      <StatTile label="Sentiment" icon="◐" accent="positive" provenance="DERIVED"
        value={s ? pct(s.sentiment.positiveShare, 0) : "–"} unit={s ? "positive" : undefined}
        note={s ? <SentimentMix s={s} /> : undefined}
        href={drillHref(query, { sentiment: "negative", view: "reviews" })} />
      <StatTile label="Intelligence Score" icon="◆" provenance="DERIVED" value={s?.intelligenceScore.score?.toFixed(1) ?? "–"}
        unit={s?.intelligenceScore.score != null ? "/100" : undefined} note="an index, not a probability" />
      <StatTile label="Verified purchases" icon="✓" provenance="OBSERVED" value={pct(s?.verifiedShare, 0)} note="of reviews in view" />
      <StatTile label="Rating disagrees with text" icon="≠" accent="warning" provenance="DERIVED" value={num(s?.ratingTextConflicts)}
        href={drillHref(query, { conflict: "true", view: "reviews" })} note="worth reading first" />
      <StatTile label="Data quality (latest import)" icon="◈" provenance="DERIVED" value={ops?.latestImport?.qualityScore?.toFixed(1) ?? "–"}
        unit={ops?.latestImport?.qualityScore != null ? "/100" : undefined}
        note={ops?.latestImport ? `${num(ops.latestImport.rows)} rows · ${ops.latestImport.filename}` : "No import yet"} href="/data" />
      <StatTile label="Processing time" icon="◷" provenance="OBSERVED" value={duration(ops?.latestImport?.durationMs)} note="upload to tagged insight" />
      <StatTile label="Analyst hours saved" icon="⧗" accent="muted" provenance="ESTIMATED" value={hours === null ? "–" : num(hours)} unit={hours === null ? undefined : "h"}
        note={minutes !== null ? <EstimateEditor minutes={minutes} onSaved={onOpsChange} /> : undefined} />
    </div>
  );
}

/** Five stars filled to the average, on one text line. */
function Stars({ rating }: { rating: number }) {
  const fill = `${Math.max(0, Math.min(1, rating / 5)) * 100}%`;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating.toFixed(2)} out of 5 stars`}>
      <span aria-hidden="true" className="relative inline-block leading-none tracking-wider text-line">
        ★★★★★
        <span className="absolute inset-0 overflow-hidden text-[#f5a623]" style={{ width: fill }}>★★★★★</span>
      </span>
      out of 5
    </span>
  );
}

/** Positive, neutral and negative shares as a tiny bar plus the two smaller shares, on one text line. */
function SentimentMix({ s }: { s: Summary }) {
  const { positiveShare: p, neutralShare: n, negativeShare: x } = s.sentiment;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex h-1.5 w-12 overflow-hidden rounded-full bg-canvas">
        <span style={{ width: `${(p ?? 0) * 100}%`, backgroundColor: "#2a78d6" }} />
        <span style={{ width: `${(n ?? 0) * 100}%`, backgroundColor: "#898781" }} />
        <span style={{ width: `${(x ?? 0) * 100}%`, backgroundColor: "#e34948" }} />
      </span>
      {pct(n, 0)} neutral · {pct(x)} negative
    </span>
  );
}

/** Inline editor for the minutes-per-review assumption. Saved for everyone and audited. */
function EstimateEditor({ minutes, onSaved }: { minutes: number; onSaved: () => void }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(minutes));
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <span>
        at {minutes} min per review{" "}
        <button type="button" onClick={() => { setValue(String(minutes)); setEditing(true); }} className="text-brand underline">change</button>
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/settings/estimates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutesPerRecord: Number(value) }) });
          setEditing(false);
          setError(null);
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <input type="number" min={0.1} max={60} step={0.1} value={value} onChange={(e) => setValue(e.target.value)}
        aria-label="Minutes per manually reviewed record" className="w-16 rounded border border-line px-1" />
      <span>min</span>
      <button type="submit" className="text-brand underline">save</button>
      <button type="button" onClick={() => setEditing(false)} className="underline">cancel</button>
      {error && <span role="alert" className="w-full text-negative">{error}</span>}
    </form>
  );
}
