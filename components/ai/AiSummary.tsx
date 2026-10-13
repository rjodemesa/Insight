"use client";

import { useEffect, useState } from "react";
import type { AISummary } from "@/lib/ai/summary";
import Card from "@/components/ui/Card";
import { useApi } from "@/components/SessionContext";
import { manila, num } from "@/components/ui/format";
import Cited, { FactList } from "./Cited";

type Summary = AISummary & { provider: string; label: string; generatedAt: string; cached: boolean };

/**
 * AI-written summary of the current filters, grounded in the same facts as Key findings.
 * Written on request (a Gemini call costs money); the same filters reuse the answer for an hour.
 */
export default function AiSummary({ query }: { query: string }) {
  const api = useApi();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(false);

  // New filters: the old summary no longer applies.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [query]);

  async function write(refresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      setData(await api<Summary>("/api/ai/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, refresh }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cited = new Set(data ? [...data.headline.facts, ...data.points.flatMap((p) => p.facts)] : []);
  return (
    <Card
      title="AI summary"
      provenance="AI"
      loading={busy}
      error={error}
      subtitle={data
        ? `${data.label} · ${manila(data.generatedAt)}${data.cached ? " (saved)" : ""} · from ${num(data.reviewsInScope)} reviews. Check each claim against its cited fact or review.`
        : "Written by AI from the key findings and a few sample reviews. Every claim cites its source."}
      actions={
        <button type="button" onClick={() => write(Boolean(data))} disabled={busy}
          className="rounded border border-brand px-3 py-1 text-brand hover:bg-brand-soft disabled:opacity-50">
          {busy ? "Writing…" : data ? "Rewrite" : "Write summary"}
        </button>
      }
    >
      {data ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium"><Cited text={data.headline.text} facts={data.facts} query={query} /></p>
          <ul className="list-disc space-y-1 pl-5">
            {data.points.map((p, i) => (
              <li key={i}>
                <Cited text={p.text} facts={data.facts} query={query} />
                {p.facts.length + p.reviews.length === 0 && <span className="ml-1 text-xs text-negative">(no source cited: treat with caution)</span>}
              </li>
            ))}
          </ul>
          {data.caveat && <p className="text-xs text-ink-muted">{data.caveat}</p>}
          {data.droppedCitations > 0 && (
            <p className="text-xs text-ink-muted">{data.droppedCitations} citation(s) pointed at sources the AI was not given and were removed.</p>
          )}
          <button type="button" onClick={() => setShowFacts(!showFacts)} className="text-xs text-brand underline">
            {showFacts ? "Hide" : "Show"} the cited facts
          </button>
          {showFacts && <FactList facts={data.facts} cited={cited} query={query} />}
        </div>
      ) : (
        !busy && !error && <p className="text-sm text-ink-muted">Not written yet for these filters.</p>
      )}
    </Card>
  );
}
