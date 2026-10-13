import Link from "next/link";
import ProvenanceBadge from "@/components/ProvenanceBadge";
import type { Provenance } from "@/lib/theme";

/** One headline number: label, value, provenance, and an optional line of context. */
export default function StatTile({
  label, value, provenance, note, href,
}: {
  label: string;
  value: React.ReactNode;
  provenance: Provenance;
  note?: React.ReactNode;
  /** Drill-down target. */
  href?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-ink-muted">
        {label}
        <ProvenanceBadge kind={provenance} />
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-muted">{note}</div>}
    </>
  );
  const cls = "block rounded-lg border border-line bg-surface p-3";
  return href ? (
    <Link href={href} className={`${cls} hover:border-brand`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
