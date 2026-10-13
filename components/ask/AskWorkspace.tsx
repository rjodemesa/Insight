"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AskAnswer } from "@/lib/ai/ask";
import FilterBar from "@/components/filters/FilterBar";
import { useFilters } from "@/components/filters/useFilters";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { day, num } from "@/components/ui/format";
import ProvenanceBadge from "@/components/ProvenanceBadge";
import Cited, { FactList, reviewHref } from "@/components/ai/Cited";

type Answer = AskAnswer & { provider: string; label: string; generatedAt: string };
interface Turn {
  question: string;
  query: string;
  answer: Answer | null;
  error: string | null;
}
interface Status {
  provider: string;
  label: string;
  configured: boolean;
}

const SUGGESTIONS = [
  "What are the top complaints in the last 30 days?",
  "Which retailer gets the most negative reviews, and why?",
  "Ano ang sinasabi ng customers tungkol sa amoy?",
  "Are leak complaints getting worse?",
];

/** Questions about the reviews under the current filters. Answers cite computed facts and redacted reviews. */
export default function AskWorkspace() {
  const api = useApi();
  const { query } = useFilters();
  const status = useJson<Status>("/api/ai/status");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [turns.length, busy]);

  async function send(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    const history = turns.filter((t) => t.answer).slice(-4).map((t) => ({ question: t.question, answer: t.answer!.answer.text }));
    setTurns((ts) => [...ts, { question: text, query, answer: null, error: null }]);
    setQuestion("");
    setBusy(true);
    try {
      const answer = await api<Answer>("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, query, history }) });
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, answer } : t)));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, error: (e as Error).message } : t)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar />
      {status.data && (
        <p className="text-xs text-ink-muted">
          Answering with {status.data.label}. Only redacted review text is sent.
          {status.data.provider === "mock" && " The mock restates the closest computed facts; set AI_PROVIDER=gemini and GEMINI_API_KEY for real answers."}
          {!status.data.configured && <span className="text-negative"> GEMINI_API_KEY is not set, so questions will fail.</span>}
        </p>
      )}

      <section aria-label="Conversation" className="space-y-4">
        {turns.length === 0 && (
          <div className="rounded-lg border border-line bg-surface p-4 text-sm">
            <p className="mb-2 text-ink-muted">Ask about the reviews under the filters above. Naming a brand, retailer or theme narrows the answer to it. Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line px-3 py-1 hover:bg-brand-soft">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[80%] rounded-lg bg-brand-soft px-3 py-2 text-sm">{t.question}</p>
            {t.error && <p role="alert" className="text-sm text-negative">{t.error}</p>}
            {!t.answer && !t.error && <p className="text-sm text-ink-muted" aria-live="polite">Reading the reviews…</p>}
            {t.answer && <AnswerCard a={t.answer} query={t.query} onFollowUp={send} />}
          </article>
        ))}
        <div ref={end} />
      </section>

      <form onSubmit={(e) => { e.preventDefault(); void send(question); }} className="sticky bottom-0 flex gap-2 border-t border-line bg-canvas py-3">
        <label htmlFor="ask-q" className="sr-only">Your question</label>
        <textarea id="ask-q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(question); } }}
          placeholder="Ask in English, Filipino or Taglish. Enter to send, Shift+Enter for a new line."
          className="flex-1 resize-none rounded border border-line bg-surface px-3 py-2 text-sm" />
        <div className="flex flex-col gap-1">
          <button type="submit" disabled={busy || !question.trim()} className="rounded bg-brand px-4 py-2 text-sm text-white hover:bg-brand-strong disabled:opacity-50">Ask</button>
          {turns.length > 0 && <button type="button" onClick={() => setTurns([])} disabled={busy} className="text-xs text-brand underline">New conversation</button>}
        </div>
      </form>
    </div>
  );
}

function AnswerCard({ a, query, onFollowUp }: { a: Answer; query: string; onFollowUp: (q: string) => void }) {
  const [showFacts, setShowFacts] = useState(false);
  const scope = Object.entries(a.scope).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ");
  const narrowed = [...a.detected.brands, ...a.detected.retailers];
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3 text-sm">
      <p className="text-xs text-ink-muted">
        <ProvenanceBadge kind="AI" /> {a.label} · read {num(a.reviewsRead)} of {num(a.reviewsInScope)} reviews in scope
        {scope ? ` (${scope})` : " (all reviews)"}
        {a.detected.themes.length > 0 && ` · themes: ${a.detected.themes.join(", ")}`}
      </p>
      {narrowed.length > 0 && <p className="text-xs text-ink-muted">Narrowed to {narrowed.join(", ")} because the question names it.</p>}
      <p><Cited text={a.answer.text} facts={a.facts} query={query} /></p>
      {a.insufficient && <p className="text-xs text-negative">The AI says these data cannot fully answer the question.</p>}
      {!a.insufficient && a.answer.facts.length + a.answer.reviews.length === 0 && (
        <p className="text-xs text-negative">This answer cites no source; treat it with caution.</p>
      )}
      {a.droppedCitations > 0 && <p className="text-xs text-ink-muted">{a.droppedCitations} citation(s) to sources the AI was not given were removed.</p>}
      {a.reviews.length > 0 && (
        <ul className="space-y-1 border-l-2 border-line pl-2 text-xs">
          {a.reviews.map((r) => (
            <li key={r.id}>
              <Link href={reviewHref(r.id)} className="font-medium text-brand underline">R{r.id}</Link>{" "}
              <span className="text-ink-muted">{[day(r.date), r.rating !== null ? `${r.rating}★` : null, r.retailer, r.brand].filter(Boolean).join(" · ")}</span>{" "}
              {r.text.length > 240 ? `${r.text.slice(0, 240)}…` : r.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {a.followUps.map((q) => (
          <button key={q} type="button" onClick={() => onFollowUp(q)} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-brand-soft">{q}</button>
        ))}
        <button type="button" onClick={() => setShowFacts(!showFacts)} className="ml-auto text-xs text-brand underline">
          {showFacts ? "Hide" : "Show"} the facts it was given ({a.facts.length})
        </button>
      </div>
      {showFacts && <FactList facts={a.facts} query={query} />}
    </div>
  );
}
