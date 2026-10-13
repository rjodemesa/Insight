"use client";

import Link from "next/link";
import { useJson } from "@/components/ui/useJson";
import Card from "@/components/ui/Card";
import { manila, num } from "@/components/ui/format";

interface TagRow {
  id: number;
  reviewId: number;
  theme: string | null;
  themeLabel: string | null;
  suggested: string | null;
  suggestedLabel: string | null;
  comment: string | null;
  createdAt: string;
  user: string | null;
}
interface Feedback {
  totals: { tags: number; redactions: number };
  tags: TagRow[];
  byTheme: { theme: string | null; themeLabel: string | null; suggested: string | null; suggestedLabel: string | null; n: number }[];
  redactions: { id: number; reviewId: number; note: string | null; createdAt: string; user: string | null }[];
}

const change = (from: string | null, to: string | null) =>
  from && to ? `${from} → ${to}` : from ? `remove ${from}` : `add ${to ?? "?"}`;

/**
 * What analysts flagged: wrong or missing tags (input for config/taxonomy.json and the
 * lexicon) and personal data the redaction missed (input for the redaction rules).
 */
export default function FeedbackQueue() {
  const { data, error, loading } = useJson<Feedback>("/api/feedback");
  return (
    <Card
      title="Feedback to review"
      subtitle={data ? `${num(data.totals.tags)} tag corrections · ${num(data.totals.redactions)} missed-redaction flags. Nothing here changes data until the rules are updated.` : undefined}
      loading={loading}
      error={error}
      empty={data && !data.totals.tags && !data.totals.redactions ? "No feedback yet. Use “Is a tag wrong?” or “Missed personal info?” under any review." : null}
    >
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="mb-1 text-sm font-semibold">Most-reported tag problems</h3>
            <ul className="mb-3 space-y-0.5 text-sm">
              {data.byTheme.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex-1">{change(t.themeLabel, t.suggestedLabel)}</span>
                  <span className="tabular-nums text-ink-muted">{num(t.n)}</span>
                </li>
              ))}
            </ul>
            <h3 className="mb-1 text-sm font-semibold">Latest tag corrections</h3>
            <ul className="max-h-72 space-y-1.5 overflow-auto text-sm">
              {data.tags.map((t) => (
                <li key={t.id}>
                  <span>{change(t.themeLabel, t.suggestedLabel)}</span>
                  <span className="text-xs text-ink-muted">
                    {" · "}<Link href={`/insights?view=reviews&review=${t.reviewId}`} className="text-brand underline">review #{t.reviewId}</Link>
                    {" · "}{t.user ?? "unknown"} · {manila(t.createdAt)}
                  </span>
                  {t.comment && <div className="text-xs italic text-ink-muted">“{t.comment}”</div>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 text-sm font-semibold">Missed personal data</h3>
            <p className="mb-1 text-xs text-ink-muted">An IT officer can reveal the original of a flagged review (with a recorded reason) to check it.</p>
            <ul className="max-h-72 space-y-1.5 overflow-auto text-sm">
              {data.redactions.map((r) => (
                <li key={r.id}>
                  <Link href={`/insights?view=reviews&review=${r.reviewId}`} className="text-brand underline">review #{r.reviewId}</Link>
                  <span className="text-xs text-ink-muted"> · {r.user ?? "unknown"} · {manila(r.createdAt)}</span>
                  {r.note && <div className="text-xs italic text-ink-muted">“{r.note}”</div>}
                </li>
              ))}
              {!data.redactions.length && <li className="text-ink-muted">None.</li>}
            </ul>
          </section>
        </div>
      )}
    </Card>
  );
}
