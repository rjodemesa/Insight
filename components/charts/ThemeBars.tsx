"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { themes } from "@/lib/insights/queries";
import Card from "@/components/ui/Card";
import { compact, num, pct } from "@/components/ui/format";
import { drillHref } from "@/components/filters/useFilters";
import { axisProps, BAR_SIZE, DataTable, ExportLink, gridProps, Legend, SENTIMENT_SERIES, SURFACE, TooltipBox, ViewToggle, type ChartView } from "./common";

type Themes = ReturnType<typeof themes>;
type Theme = Themes["themes"][number];

/**
 * Most-mentioned themes as horizontal bars split by the sentiment of the mention, or
 * sorted by complaints. Clicking a bar opens the reviews behind it.
 */
export default function ThemeBars({ data, query, loading, error, limit = 12 }: { data: Themes | null; query: string; loading: boolean; error: string | null; limit?: number }) {
  const router = useRouter();
  const [sort, setSort] = useState<"mentions" | "complaints">("complaints");
  const [view, setView] = useState<ChartView>("chart");
  const list = (data?.themes ?? [])
    .slice()
    .sort((a, b) => (sort === "complaints" ? b.negative - a.negative : b.reviews - a.reviews))
    .slice(0, limit);
  const open = (t: Theme) =>
    router.push(drillHref(query, { theme: t.theme, themeSentiment: sort === "complaints" ? "negative" : null, view: "reviews" }));
  const rising = (t: Theme) => (t.negativeChange.significant && t.negativeChange.direction === "up" ? " ▲" : "");

  return (
    <Card
      title="Top themes"
      provenance="DERIVED"
      subtitle={sort === "complaints" ? "Themes with the most negative mentions. ▲ = significantly rising." : "Most-mentioned themes, by sentiment of the mention."}
      loading={loading}
      error={error}
      empty={data && !data.themes.length ? "No themes found in these reviews." : null}
      actions={
        <>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort themes" className="rounded border border-line px-1 py-0.5 text-xs">
            <option value="complaints">Most complaints</option>
            <option value="mentions">Most mentioned</option>
          </select>
          <ViewToggle view={view} onChange={setView} />
          <ExportLink kind="themes" query={query} />
        </>
      }
    >
      {data && view === "chart" && (
        <>
          <Legend items={SENTIMENT_SERIES} />
          <div style={{ height: Math.max(160, list.length * 30 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={list.map((t) => ({ ...t, name: t.label + rising(t) }))} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} vertical horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={compact} />
                <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={170} interval={0} />
                <Tooltip
                  cursor={{ fill: "rgba(0,71,187,0.06)" }}
                  content={({ active, payload }) => {
                    const t = active && payload?.[0] ? (payload[0].payload as Theme) : null;
                    if (!t) return null;
                    return (
                      <TooltipBox
                        title={`${t.label} · ${t.vector}`}
                        rows={[
                          ...SENTIMENT_SERIES.map((s) => ({ label: s.label, color: s.color, value: num(t[s.key]) })),
                          { label: "Share of reviews with text", value: pct(t.share) },
                          ...(t.negativeChange.significant
                            ? [{ label: "Complaint share change", value: `${(t.negativeChange.diffPts ?? 0) > 0 ? "+" : ""}${t.negativeChange.diffPts} pts` }]
                            : []),
                        ]}
                        hint="Click to read these reviews"
                      />
                    );
                  }}
                />
                {(sort === "complaints" ? [...SENTIMENT_SERIES].reverse() : SENTIMENT_SERIES).map((s, i, arr) => (
                  <Bar key={s.key} dataKey={s.key} stackId="t" fill={s.color} stroke={SURFACE} strokeWidth={1} maxBarSize={BAR_SIZE}
                    radius={i === arr.length - 1 ? [0, 4, 4, 0] : 0} cursor="pointer" isAnimationActive={false}
                    onClick={(d) => open((d as unknown as { payload: Theme }).payload)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {data && view === "table" && (
        <DataTable
          columns={[
            { key: "label", label: "Theme" }, { key: "vector", label: "Vector" }, { key: "reviews", label: "Mentions", numeric: true },
            { key: "negative", label: "Negative", numeric: true }, { key: "negativeShare", label: "Negative share", numeric: true },
            { key: "change", label: "Complaint change", numeric: true },
          ]}
          rows={list.map((t) => ({
            label: <button type="button" className="text-left text-brand underline" onClick={() => open(t)}>{t.label}</button>,
            vector: t.vector, reviews: num(t.reviews), negative: num(t.negative), negativeShare: pct(t.negativeShare),
            change: t.negativeChange.significant ? `${(t.negativeChange.diffPts ?? 0) > 0 ? "+" : ""}${t.negativeChange.diffPts} pts` : "no significant change",
          }))}
        />
      )}
    </Card>
  );
}
