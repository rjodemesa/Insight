import Link from "next/link";
import ProvenanceBadge from "@/components/ProvenanceBadge";
import type { Provenance } from "@/lib/theme";

export type Accent = "brand" | "positive" | "warning" | "muted";

const ACCENT: Record<Accent, string> = {
  brand: "bg-brand",
  positive: "bg-positive",
  warning: "bg-[#c98500]",
  muted: "bg-estimated",
};

/**
 * One headline number: label, value, provenance, and an optional line of context.
 * The accent stripe sits inside the border, so every tile keeps the same size.
 */
export default function StatTile({
  label, value, provenance, note, href, icon, unit, accent = "brand",
}: {
  label: string;
  value: React.ReactNode;
  provenance: Provenance;
  note?: React.ReactNode;
  /** Drill-down target. */
  href?: string;
  /** A short glyph shown before the label. */
  icon?: string;
  /** Shown small after the value, e.g. "/5". */
  unit?: string;
  accent?: Accent;
}) {
  const body = (
    <>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${ACCENT[accent]}`} />
      <div className="flex items-center justify-between gap-1 text-xs text-ink-muted">
        <span className="truncate">
          {icon && <span aria-hidden="true" className="mr-1 text-brand/70">{icon}</span>}
          {label}
        </span>
        <ProvenanceBadge kind={provenance} />
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-brand-strong tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-sm font-normal text-ink-muted">{unit}</span>}
      </div>
      {note && <div className="mt-0.5 text-xs text-ink-muted">{note}</div>}
      {href && <span aria-hidden="true" className="absolute right-2 bottom-2 text-xs text-brand opacity-0 transition-opacity group-hover:opacity-100">→</span>}
    </>
  );
  const cls = "group relative block overflow-hidden rounded-lg border border-line bg-gradient-to-br from-surface to-canvas/60 p-3 pl-4";
  return href ? (
    <Link href={href} className={`${cls} transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
