/** "How is this calculated?" disclosure. Content comes from the API's `method` fields, so it matches the code. */
export default function MethodPanel({ items, title = "How is this calculated?" }: { items: { label: string; text: string }[]; title?: string }) {
  return (
    <details className="rounded-lg border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium text-brand">{title}</summary>
      <dl className="mt-2 space-y-2">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="font-medium">{i.label}</dt>
            <dd className="text-ink-muted">{i.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
