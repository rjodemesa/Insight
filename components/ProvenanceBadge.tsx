import { PROVENANCE, type Provenance } from "@/lib/theme";

/** OBSERVED | DERIVED | AI | ESTIMATED label with its definition as a tooltip. */
export default function ProvenanceBadge({ kind }: { kind: Provenance }) {
  const p = PROVENANCE[kind];
  return (
    <abbr
      title={`${kind}: ${p.definition}`}
      className="ml-1 inline-block cursor-help rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-wide text-white no-underline"
      style={{ backgroundColor: p.color }}
    >
      {kind}
    </abbr>
  );
}
