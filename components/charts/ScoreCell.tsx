import type { ScoreResult } from "@/lib/score/intelligence";
import { C } from "./common";

/** Intelligence Score as a number with a thin meter. Low-sample scores say so. */
export default function ScoreCell({ s }: { s: ScoreResult }) {
  if (s.score === null) return <span className="text-ink-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-2" title={`Raw ${s.raw ?? "–"}, shrunk toward ${s.prior ?? "–"} · n=${s.n} · reliability ${s.reliability}`}>
      <span className="tabular-nums font-medium">{s.score.toFixed(1)}</span>
      <span aria-hidden="true" className="relative inline-block h-1.5 w-16 overflow-hidden rounded-full" style={{ backgroundColor: "#cde2fb" }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${s.score}%`, backgroundColor: C.single }} />
      </span>
      {s.reliability === "low" && <span className="text-[11px] text-ink-muted">low n</span>}
    </span>
  );
}
