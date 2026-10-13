import ProvenanceBadge from "@/components/ProvenanceBadge";
import type { Provenance } from "@/lib/theme";

/**
 * Titled panel for a chart or table. Shows the error, an empty message or a first-load
 * placeholder in place of the content; on refetch the old content stays, dimmed.
 */
export default function Card({
  title, provenance, subtitle, actions, loading, error, empty, children, className = "",
}: {
  title: string;
  provenance?: Provenance;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  /** Message to show instead of children when there is nothing to plot. */
  empty?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const id = `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const first = loading && !children;
  return (
    <section aria-labelledby={id} aria-busy={loading || undefined} className={`rounded-lg border border-line bg-surface p-4 ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={id} className="text-base font-semibold">
            {title}
            {provenance && <ProvenanceBadge kind={provenance} />}
          </h2>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 text-sm">{actions}</div>}
      </header>
      {error ? (
        <p role="alert" className="text-sm text-negative">{error}</p>
      ) : first ? (
        <div className="h-40 animate-pulse rounded bg-canvas" aria-label="Loading" />
      ) : empty ? (
        <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>{children}</div>
      )}
    </section>
  );
}
