"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/components/ui/Card";
import { num, pct } from "@/components/ui/format";
import type { Provenance } from "@/lib/theme";
import { axisProps, BAR_SIZE, C, DataTable, ExportLink, gridProps, LABEL, TooltipBox, ViewToggle, type ChartView } from "./common";

export interface ShareRow {
  key: string;
  label: string;
  /** 0..1 */
  value: number | null;
  /** Sample size behind the share. */
  n: number;
  /** Extra tooltip/table rows. */
  details?: { label: string; value: string }[];
}

/**
 * One measure (a share, 0–100%) per group as horizontal bars, one colour, with the sample
 * size at the bar tip so small groups are visible as small. Click opens the group's reviews.
 */
export default function ShareBars({
  title, subtitle, measure, rows, onOpen, exportKind, query, loading, error, provenance = "DERIVED", minN = 0,
}: {
  title: string;
  subtitle: string;
  /** e.g. "Negative share" */
  measure: string;
  rows: ShareRow[];
  onOpen: (key: string) => void;
  exportKind?: string;
  query: string;
  loading: boolean;
  error: string | null;
  provenance?: Provenance;
  /** Groups below this sample size are listed in the table only. */
  minN?: number;
}) {
  const [view, setView] = useState<ChartView>("chart");
  const plotted = rows.filter((r) => r.value !== null && r.n >= minN);
  const hidden = rows.length - plotted.length;
  return (
    <Card
      title={title}
      provenance={provenance}
      subtitle={hidden > 0 ? `${subtitle} ${hidden} group${hidden > 1 ? "s" : ""} with fewer than ${minN} reviews are in the table only.` : subtitle}
      loading={loading}
      error={error}
      empty={!loading && !rows.length ? "Nothing to compare for these filters." : null}
      actions={
        <>
          <ViewToggle view={view} onChange={setView} />
          {exportKind && <ExportLink kind={exportKind} query={query} />}
        </>
      }
    >
      {view === "chart" ? (
        <div style={{ height: Math.max(120, plotted.length * 30 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={plotted} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} vertical horizontal={false} />
              <XAxis type="number" {...axisProps} domain={[0, (max: number) => Math.min(1, Math.max(0.05, Math.ceil(max * 20) / 20))]} tickFormatter={(v: number) => pct(v, 0)} />
              <YAxis type="category" dataKey="label" {...axisProps} axisLine={false} width={150} interval={0} />
              <Tooltip
                cursor={{ fill: "rgba(0,71,187,0.06)" }}
                content={({ active, payload }) => {
                  const r = active && payload?.[0] ? (payload[0].payload as ShareRow) : null;
                  return r ? (
                    <TooltipBox title={r.label} rows={[{ label: measure, value: pct(r.value), color: C.single }, { label: "Reviews", value: num(r.n) }, ...(r.details ?? [])]} hint="Click to read these reviews" />
                  ) : null;
                }}
              />
              <Bar dataKey="value" fill={C.single} maxBarSize={BAR_SIZE} radius={[0, 4, 4, 0]} cursor="pointer" isAnimationActive={false}
                onClick={(d) => onOpen((d as unknown as { payload: ShareRow }).payload.key)}>
                <LabelList dataKey="value" position="right" fill={LABEL} fontSize={11}
                  formatter={(v: unknown) => pct(v as number)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <DataTable
          columns={[
            { key: "label", label: "Group" }, { key: "n", label: "Reviews", numeric: true }, { key: "value", label: measure, numeric: true },
            ...(rows[0]?.details ?? []).map((d) => ({ key: d.label, label: d.label, numeric: true })),
          ]}
          rows={rows.map((r) => ({
            label: <button type="button" className="text-left text-brand underline" onClick={() => onOpen(r.key)}>{r.label}</button>,
            n: num(r.n), value: pct(r.value),
            ...Object.fromEntries((r.details ?? []).map((d) => [d.label, d.value])),
          }))}
        />
      )}
    </Card>
  );
}
