"use client";

import { theme } from "@/lib/theme";

/**
 * Shared chart chrome (see the dataviz rules): hairline solid grid, muted axis text,
 * bars ≤ 24px with a 4px rounded end, a 2px surface-colored gap between touching
 * segments, legends in text ink beside a colored swatch, and a table view for every chart.
 */
export const C = theme.chart;
export const SURFACE = "#ffffff";
export const BAR_SIZE = 18;

export const axisProps = {
  stroke: C.grid,
  tick: { fill: C.label, fontSize: 12 },
  tickLine: false,
} as const;

export const gridProps = { stroke: C.grid, strokeDasharray: undefined, vertical: false } as const;

export const SENTIMENT_SERIES = [
  { key: "positive", label: "Positive", color: C.positive },
  { key: "neutral", label: "Neutral", color: C.neutral },
  { key: "negative", label: "Negative", color: C.negative },
] as const;

export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Tooltip body: a title and label/value rows, each with its series swatch. */
export function TooltipBox({ title, rows, hint }: { title: string; rows: { label: string; value: string; color?: string }[]; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-ink-muted">
          {r.color && <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: r.color }} />}
          <span className="flex-1">{r.label}</span>
          <span className="tabular-nums text-ink">{r.value}</span>
        </div>
      ))}
      {hint && <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>}
    </div>
  );
}

export type ChartView = "chart" | "table";

export function ViewToggle({ view, onChange }: { view: ChartView; onChange: (v: ChartView) => void }) {
  return (
    <div role="group" aria-label="Show as" className="inline-flex overflow-hidden rounded border border-line text-xs">
      {(["chart", "table"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => onChange(v)}
          className={`px-2 py-0.5 ${view === v ? "bg-brand text-white" : "bg-surface hover:bg-canvas"}`}>
          {v === "chart" ? "Chart" : "Table"}
        </button>
      ))}
    </div>
  );
}

/** Plain data table: the accessible twin of a chart. */
export function DataTable({ columns, rows }: { columns: { key: string; label: string; numeric?: boolean }[]; rows: Record<string, React.ReactNode>[] }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-ink-muted">
          <tr>{columns.map((c) => <th key={c.key} className={`py-1 pr-3 font-medium ${c.numeric ? "text-right" : ""}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {columns.map((c) => <td key={c.key} className={`py-1 pr-3 ${c.numeric ? "text-right tabular-nums" : ""}`}>{r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportLink({ kind, query }: { kind: string; query: string }) {
  return (
    <a href={`/api/export?kind=${kind}${query ? `&${query}` : ""}`} download className="text-xs text-brand underline" title="Download the data behind this view as Excel">
      Export
    </a>
  );
}
