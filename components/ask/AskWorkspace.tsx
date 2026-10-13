"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AskAnswer } from "@/lib/ai/ask";
import FilterBar from "@/components/filters/FilterBar";
import { drillHref, useFilters } from "@/components/filters/useFilters";
import { PREPARED_ANSWERS, SNAPSHOT, type PreparedAnswer } from "@/lib/ai/preparedAnswers";
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
  /** A prepared answer to a sample question, shown without calling the AI. */
  prepared?: PreparedAnswer;
}
interface Status {
  provider: string;
  label: string;
  configured: boolean;
}

/** Sample questions open their prepared answer; "Ask the AI instead" sends them to the live provider. */
const SUGGESTIONS = PREPARED_ANSWERS.map((a) => a.question);

/** Questions about the reviews under the current filters. Answers cite computed facts and redacted reviews. */
export default function AskWorkspace() {
  const api = useApi();
  const { query } = useFilters();
  const status = useJson<Status>("/api/ai/status");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  // Prepared answers describe one import; warn when the loaded data is different.
  const all = useJson<{ reviews: number; dateRange: { to: string | null } }>("/api/aggregates/summary");
  const snapshotMatches = !all.data || (all.data.reviews === SNAPSHOT.reviews && all.data.dateRange.to?.slice(0, 10) === SNAPSHOT.to);

  function showPrepared(q: string) {
    const prepared = PREPARED_ANSWERS.find((a) => a.question === q);
    if (!prepared || busy) return;
    setTurns((ts) => [...ts, { question: q, query, answer: null, error: null, prepared }]);
  }

  // Braces matter: newer browsers return a Promise from smooth scrollIntoView, and an effect may only return a clean-up function.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

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
                <button key={s} type="button" onClick={() => showPrepared(s)} className="rounded-full border border-line px-3 py-1 hover:bg-brand-soft">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[80%] rounded-lg bg-brand-soft px-3 py-2 text-sm">{t.question}</p>
            {t.error && <p role="alert" className="text-sm text-negative">{t.error}</p>}
            {!t.answer && !t.error && !t.prepared && <p className="text-sm text-ink-muted" aria-live="polite">Reading the reviews…</p>}
            {t.answer && <AnswerCard a={t.answer} query={t.query} onFollowUp={send} />}
            {t.prepared && <PreparedCard a={t.prepared} filtered={Boolean(t.query)} snapshotMatches={snapshotMatches} busy={busy} onAskAi={() => void send(t.question)} />}
          </article>
        ))}
        {turns.length > 0 && SUGGESTIONS.some((q) => !turns.some((t) => t.question === q)) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted">More sample questions:</span>
            {SUGGESTIONS.filter((q) => !turns.some((t) => t.question === q)).map((q) => (
              <button key={q} type="button" onClick={() => showPrepared(q)} className="rounded-full border border-line px-2 py-0.5 hover:bg-brand-soft">{q}</button>
            ))}
          </div>
        )}
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

/**
 * A prepared answer: plain language for a general audience, with the numbers, quotes and
 * caveats behind it. Written by people from the app's numbers, so it carries no AI label.
 */
function PreparedCard({ a, filtered, snapshotMatches, busy, onAskAi }: { a: PreparedAnswer; filtered: boolean; snapshotMatches: boolean; busy: boolean; onAskAi: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="text-xs text-ink-muted">
        <ProvenanceBadge kind="DERIVED" /> Prepared answer, written from the app's numbers for {SNAPSHOT.label}. Not generated by AI.
      </p>
      {!snapshotMatches && (
        <p role="note" className="rounded border border-[#c98500] px-2 py-1 text-xs">The data has changed since this answer was written, so its numbers may be out of date. Ask the AI for a current answer.</p>
      )}
      {filtered && <p className="text-xs text-ink-muted">This answer covers all reviews; the filters above are not applied to it.</p>}
      <p className="text-base font-semibold text-brand">{a.headline}</p>
      {a.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {a.list && (
        <div>
          <p className="mb-1 text-xs font-medium text-ink-muted">{a.list.title}</p>
          <ol className="space-y-0.5">
            {a.list.items.map((it, i) => (
              <li key={it.label} className="flex gap-2">
                <span className="w-4 text-right text-ink-muted">{i + 1}.</span>
                <span className="flex-1">{it.label}{it.note && <span className="text-xs text-ink-muted"> · {it.note}</span>}</span>
                <span className="tabular-nums font-medium">{it.value}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {a.english && <p className="text-xs italic text-ink-muted">In English: {a.english}</p>}
      {a.quotes.length > 0 && (
        <ul className="space-y-2 border-l-2 border-brand-light pl-3">
          {a.quotes.map((q) => (
            <li key={q.reviewId}>
              <q className="italic">{q.text}</q>
              {q.translation && <span className="block text-xs text-ink-muted">“{q.translation}”</span>}
              <span className="block text-xs text-ink-muted">
                {q.source} · <Link href={reviewHref(q.reviewId)} className="text-brand underline">review {q.reviewId}</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded bg-canvas p-2 text-xs">
        <p className="mb-1 font-medium">Worth keeping in mind</p>
        <ul className="list-disc space-y-0.5 pl-4">
          {a.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <Link href={drillHref("", { ...a.drill, view: "reviews" })} className="text-brand underline">Read the reviews behind this</Link>
        <button type="button" onClick={onAskAi} disabled={busy} className="text-brand underline disabled:opacity-50">Ask the AI instead</button>
      </div>
    </div>
  );
}
