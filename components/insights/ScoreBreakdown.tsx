import type { ScoreResult } from "@/lib/score/intelligence";
import Card from "@/components/ui/Card";
import MethodPanel from "@/components/ui/MethodPanel";
import { num, pct } from "@/components/ui/format";
import { C } from "@/components/charts/common";

const PARTS = [
  ["sentiment", "Text sentiment", "40%"],
  ["rating", "Star rating", "35%"],
  ["issueFree", "Free of complaints", "25%"],
] as const;

/** Intelligence Score with its three components, the comparison prior and sample size. */
export default function ScoreBreakdown({ s, comparedWith, formula, trustWeight }: { s: ScoreResult; comparedWith: string; formula: string; trustWeight: string }) {
  return (
    <Card title="Intelligence Score" provenance="DERIVED" subtitle="A 0–100 index for comparing products and brands. Not a probability.">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="text-5xl font-semibold">{s.score?.toFixed(1) ?? "–"}</div>
          <div className="text-xs text-ink-muted">
            reliability <strong>{s.reliability}</strong> · n = {num(s.n)} (effective {num(s.effectiveN)})
          </div>
        </div>
        <dl className="min-w-64 flex-1 space-y-1.5 text-sm">
          {PARTS.map(([k, label, weight]) => {
            const v = s.components[k];
            return (
              <div key={k} className="flex items-center gap-2">
                <dt className="w-40 text-ink-muted">{label} <span className="text-xs">({weight})</span></dt>
                <dd className="flex flex-1 items-center gap-2">
                  <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "#cde2fb" }}>
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(v ?? 0) * 100}%`, backgroundColor: C.single }} />
                  </span>
                  <span className="w-12 text-right tabular-nums">{pct(v, 0)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        Raw score {s.raw?.toFixed(1) ?? "–"}, pulled toward {s.prior?.toFixed(1) ?? "–"} ({comparedWith}) in proportion to how few reviews there are.
      </p>
      <div className="mt-3">
        <MethodPanel items={[{ label: "Formula", text: formula }, { label: "Trust weight", text: trustWeight }]} />
      </div>
    </Card>
  );
}
