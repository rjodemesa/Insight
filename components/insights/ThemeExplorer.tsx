"use client";

import Link from "next/link";
import type { themes } from "@/lib/insights/queries";
import Card from "@/components/ui/Card";
import { day, num, pct } from "@/components/ui/format";
import { drillHref } from "@/components/filters/useFilters";
import { C, ExportLink } from "@/components/charts/common";

type Themes = ReturnType<typeof themes>;
type Theme = Themes["themes"][number];
type Change = Theme["change"];

function ChangeBadge({ c, label }: { c: Change; label: string }) {
  if (!c.significant) return <span className="text-ink-muted" title={`No significant change (z = ${c.z ?? "–"})`}>–</span>;
  const up = c.direction === "up";
  return (
    <span title={`${label}: ${pct(c.previous)} → ${pct(c.current)} (z = ${c.z})`} className={up ? "text-negative" : "text-[#1c5cab]"}>
      {up ? "▲" : "▼"} {Math.abs(c.diffPts ?? 0)} pts
    </span>
  );
}

/** Sentiment split as a thin 100% bar: blue positive, gray neutral, red negative. */
function SplitBar({ t }: { t: Theme }) {
  const total = t.positive + t.neutral + t.negative || 1;
  return (
    <span aria-hidden="true" className="flex h-2 w-24 overflow-hidden rounded-full bg-canvas">
      <span style={{ width: `${(t.positive / total) * 100}%`, backgroundColor: C.positive }} />
      <span style={{ width: `${(t.neutral / total) * 100}%`, backgroundColor: C.neutral, borderLeft: "1px solid #fff" }} />
      <span style={{ width: `${(t.negative / total) * 100}%`, backgroundColor: C.negative, borderLeft: "1px solid #fff" }} />
    </span>
  );
}

/** Every theme grouped under its Five Vector, with mentions, complaint share and change vs the baseline window. */
export default function ThemeExplorer({ data, query, loading, error }: { data: Themes | null; query: string; loading: boolean; error: string | null }) {
  const vectors = (data?.vectors ?? []).slice().sort((a, b) => b.reviews - a.reviews);
  return (
    <Card
      title="Theme explorer"
      provenance="DERIVED"
      subtitle={
        data?.window
          ? `${num(data.reviewsWithText)} reviews with text. Change compares ${day(data.window.recent.from)}–${day(data.window.recent.to)} (n=${num(data.window.recent.reviews)}) with the ${data.window.days * 3} days before (n=${num(data.window.baseline.reviews)}).`
          : undefined
      }
      loading={loading}
      error={error}
      empty={data && !data.themes.length ? "No themes found in these reviews." : null}
      actions={<ExportLink kind="themes" query={query} />}
    >
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Theme</th>
                <th className="pr-3 text-right font-medium">Mentions</th>
                <th className="pr-3 text-right font-medium">Share</th>
                <th className="pr-3 font-medium">Sentiment</th>
                <th className="pr-3 text-right font-medium">Negative</th>
                <th className="pr-3 text-right font-medium" title="Change in the share of reviews mentioning the theme">Mention change</th>
                <th className="pr-3 text-right font-medium" title="Change in the share of reviews complaining about the theme">Complaint change</th>
                <th className="font-medium">Read</th>
              </tr>
            </thead>
            {vectors.map((v) => (
              <tbody key={v.vector}>
                <tr className="border-t-2 border-line bg-canvas">
                  <th colSpan={8} scope="rowgroup" className="py-1.5 pl-1 text-left">
                    {v.vector}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {num(v.reviews)} reviews ({pct(v.share)}) · {pct(v.negativeShare)} negative
                    </span>
                  </th>
                </tr>
                {data.themes.filter((t) => t.vector === v.vector).map((t) => (
                  <tr key={t.theme} className="border-t border-line">
                    <td className="py-1.5 pr-3">
                      {t.label}
                      {t.sources.human + t.sources.AI > 0 && (
                        <span className="ml-1 text-xs text-ink-muted">({num(t.sources.AI)} AI, {num(t.sources.human)} human)</span>
                      )}
                    </td>
                    <td className="pr-3 text-right tabular-nums">{num(t.reviews)}</td>
                    <td className="pr-3 text-right tabular-nums">{pct(t.share)}</td>
                    <td className="pr-3" title={`${num(t.positive)} positive · ${num(t.neutral)} neutral · ${num(t.negative)} negative`}><SplitBar t={t} /></td>
                    <td className="pr-3 text-right tabular-nums">{pct(t.negativeShare)}</td>
                    <td className="pr-3 text-right tabular-nums"><ChangeBadge c={t.change} label="Mention share" /></td>
                    <td className="pr-3 text-right tabular-nums"><ChangeBadge c={t.negativeChange} label="Complaint share" /></td>
                    <td className="whitespace-nowrap">
                      <Link href={drillHref(query, { theme: t.theme, themeSentiment: null, view: "reviews" })} className="text-brand underline">all</Link>
                      {t.negative > 0 && (
                        <>
                          {" · "}
                          <Link href={drillHref(query, { theme: t.theme, themeSentiment: "negative", view: "reviews" })} className="text-brand underline">complaints</Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className="mt-2 text-xs text-ink-muted">{data.method}</p>
        </div>
      )}
    </Card>
  );
}
