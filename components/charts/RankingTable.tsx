"use client";

import Link from "next/link";
import Card from "@/components/ui/Card";
import { num, pct } from "@/components/ui/format";
import type { ScoreResult } from "@/lib/score/intelligence";
import { ExportLink } from "./common";
import ScoreCell from "./ScoreCell";

export interface RankRow {
  key: string;
  label: string;
  sub?: string | null;
  href: string;
  reviews: number;
  averageRating: number | null;
  negativeShare: number | null;
  intelligenceScore: ScoreResult;
}

/** Ranked table by Intelligence Score, each row linking to its detail page. */
export default function RankingTable({
  title, subtitle, rows, exportKind, query, loading, error, nameLabel, footer,
}: {
  title: string;
  subtitle?: string;
  rows: RankRow[];
  exportKind: string;
  query: string;
  loading: boolean;
  error: string | null;
  nameLabel: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card title={title} provenance="DERIVED" subtitle={subtitle} loading={loading} error={error}
      empty={!loading && !rows.length ? "Nothing to rank for these filters." : null}
      actions={<ExportLink kind={exportKind} query={query} />}>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-ink-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="pr-3 font-medium">{nameLabel}</th>
              <th className="pr-3 text-right font-medium">Reviews</th>
              <th className="pr-3 text-right font-medium">Rating</th>
              <th className="pr-3 text-right font-medium">Negative</th>
              <th className="font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-1.5 pr-2 tabular-nums text-ink-muted">{i + 1}</td>
                <td className="pr-3">
                  <Link href={r.href} className="text-brand hover:underline">{r.label}</Link>
                  {r.sub && <div className="text-xs text-ink-muted">{r.sub}</div>}
                </td>
                <td className="pr-3 text-right tabular-nums">{num(r.reviews)}</td>
                <td className="pr-3 text-right tabular-nums">{r.averageRating?.toFixed(2) ?? "–"}</td>
                <td className="pr-3 text-right tabular-nums">{pct(r.negativeShare)}</td>
                <td><ScoreCell s={r.intelligenceScore} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </Card>
  );
}
