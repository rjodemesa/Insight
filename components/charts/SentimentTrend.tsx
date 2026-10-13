"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { trend } from "@/lib/insights/queries";
import Card from "@/components/ui/Card";
import { compact, month, monthEnd, num, pct } from "@/components/ui/format";
import { drillHref } from "@/components/filters/useFilters";
import { axisProps, BAR_SIZE, DataTable, ExportLink, gridProps, Legend, SENTIMENT_SERIES, SURFACE, TooltipBox, ViewToggle, type ChartView } from "./common";

type Trend = ReturnType<typeof trend>;
type Point = Trend["series"][number];

/**
 * Reviews per month split by sentiment. "Count" stacks the tagged reviews; "Share" shows
 * each month as 100% so months with different volumes compare fairly (one scale either
 * way, never a second axis). Clicking a month opens its reviews.
 */
export default function SentimentTrend({ data, query, loading, error }: { data: Trend | null; query: string; loading: boolean; error: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"count" | "share">("count");
  const [view, setView] = useState<ChartView>("chart");
  const rows = (data?.series ?? []).map((p) => {
    const tagged = p.positive + p.neutral + p.negative;
    return mode === "count" ? p : { ...p, positive: tagged ? p.positive / tagged : 0, neutral: tagged ? p.neutral / tagged : 0, negative: tagged ? p.negative / tagged : 0 };
  });
  const open = (period: string) => router.push(drillHref(query, { from: `${period}-01`, to: monthEnd(period), view: "reviews" }));
  const change = data?.latestChange?.negativeShare;

  return (
    <Card
      title="Sentiment over time"
      provenance="DERIVED"
      subtitle={
        change?.significant
          ? `Negative share ${change.direction} ${Math.abs(change.diffPts ?? 0)} pts in ${month(data!.latestChange!.period)} vs ${month(data!.latestChange!.comparedWith)} (significant).`
          : "Tagged reviews per month. Click a month to read its reviews."
      }
      loading={loading}
      error={error}
      empty={data && !data.series.length ? "No dated reviews match these filters." : null}
      actions={
        <>
          <div role="group" aria-label="Measure" className="inline-flex overflow-hidden rounded border border-line text-xs">
            {(["count", "share"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`px-2 py-0.5 ${mode === m ? "bg-brand text-white" : "bg-surface hover:bg-canvas"}`}>
                {m === "count" ? "Count" : "Share"}
              </button>
            ))}
          </div>
          <ViewToggle view={view} onChange={setView} />
          <ExportLink kind="trend" query={query} />
        </>
      }
    >
      {data && view === "chart" && (
        <>
          <Legend items={SENTIMENT_SERIES} />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="period" {...axisProps} tickFormatter={month} minTickGap={24} />
                <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={(v: number) => (mode === "share" ? pct(v, 0) : compact(v))}
                  domain={mode === "share" ? [0, 1] : [0, "auto"]} />
                <Tooltip
                  cursor={{ fill: "rgba(0,71,187,0.06)" }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0] ? (payload[0].payload as Point) : null;
                    if (!p) return null;
                    const orig = data.series.find((s) => s.period === p.period)!;
                    const tagged = orig.positive + orig.neutral + orig.negative;
                    return (
                      <TooltipBox
                        title={month(p.period)}
                        rows={[
                          ...SENTIMENT_SERIES.map((s) => ({ label: s.label, color: s.color, value: `${num(orig[s.key])} (${pct(tagged ? orig[s.key] / tagged : null)})` })),
                          { label: "All reviews", value: num(orig.n) },
                          { label: "Average rating", value: orig.averageRating?.toFixed(2) ?? "–" },
                        ]}
                        hint="Click to read these reviews"
                      />
                    );
                  }}
                />
                {SENTIMENT_SERIES.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="s"
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={1}
                    maxBarSize={BAR_SIZE + 6}
                    radius={i === SENTIMENT_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                    cursor="pointer"
                    onClick={(d) => open((d as unknown as { payload: Point }).payload.period)}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {data && view === "table" && (
        <DataTable
          columns={[
            { key: "period", label: "Month" }, { key: "n", label: "Reviews", numeric: true },
            { key: "positive", label: "Positive", numeric: true }, { key: "neutral", label: "Neutral", numeric: true },
            { key: "negative", label: "Negative", numeric: true }, { key: "negativeShare", label: "Negative share", numeric: true },
            { key: "averageRating", label: "Avg rating", numeric: true },
          ]}
          rows={data.series.map((p) => ({
            period: <button type="button" className="text-brand underline" onClick={() => open(p.period)}>{month(p.period)}</button>,
            n: num(p.n), positive: num(p.positive), neutral: num(p.neutral), negative: num(p.negative),
            negativeShare: pct(p.negativeShare), averageRating: p.averageRating?.toFixed(2) ?? "–",
          }))}
        />
      )}
    </Card>
  );
}
