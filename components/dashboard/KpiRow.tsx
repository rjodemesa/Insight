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
      <StatTile label="Reviews" provenance="OBSERVED" value={num(s?.reviews)} href={reviewsHref}
        note={s ? `${num(s.withText)} with text` : undefined} />
      <StatTile label="Products" provenance="DERIVED" value={num(s?.products)} href={drillHref(query, { view: "products" })}
        note={s ? `${num(s.brands)} brands · ${num(s.retailers)} retailers` : undefined} />
      <StatTile label="Average rating" provenance="OBSERVED" value={s?.averageRating?.toFixed(2) ?? "–"} note="out of 5" />
      <StatTile label="Sentiment" provenance="DERIVED"
        value={s ? `${pct(s.sentiment.positiveShare, 0)} positive` : "–"}
        note={s ? `${pct(s.sentiment.neutralShare, 0)} neutral · ${pct(s.sentiment.negativeShare)} negative` : undefined}
        href={drillHref(query, { sentiment: "negative", view: "reviews" })} />
      <StatTile label="Intelligence Score" provenance="DERIVED" value={s?.intelligenceScore.score?.toFixed(1) ?? "–"}
        note="0–100 index, not a probability" />
      <StatTile label="Verified purchases" provenance="OBSERVED" value={pct(s?.verifiedShare, 0)} />
      <StatTile label="Rating disagrees with text" provenance="DERIVED" value={num(s?.ratingTextConflicts)}
        href={drillHref(query, { conflict: "true", view: "reviews" })} note="worth reading first" />
      <StatTile label="Data quality (latest import)" provenance="DERIVED" value={ops?.latestImport?.qualityScore?.toFixed(1) ?? "–"}
        note={ops?.latestImport ? `${num(ops.latestImport.rows)} rows · ${ops.latestImport.filename}` : "No import yet"} href="/data" />
      <StatTile label="Processing time" provenance="OBSERVED" value={duration(ops?.latestImport?.durationMs)} note="upload to tagged insight" />
      <StatTile label="Analyst hours saved" provenance="ESTIMATED" value={hours === null ? "–" : num(hours)}
        note={minutes !== null ? <EstimateEditor minutes={minutes} onSaved={onOpsChange} /> : undefined} />
    </div>
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
