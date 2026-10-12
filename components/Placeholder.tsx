export default function Placeholder({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby="page-title" className="space-y-3">
      <h1 id="page-title" className="text-2xl font-semibold">{title}</h1>
      <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-ink-muted">
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-brand">Coming in Phase {phase}</p>
        {children}
      </div>
    </section>
  );
}
