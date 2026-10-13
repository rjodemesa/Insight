"use client";

import { useState } from "react";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import type { FilterOptions } from "@/components/filters/FilterBar";

interface Props {
  kind: "tag" | "pii";
  review: { id: number; sentiment: string | null; themes: { theme: string; label: string }[] };
  onClose: () => void;
}

/**
 * Inline forms behind "Is a tag wrong?" and "Missed personal info?". Feedback is stored
 * for whoever improves the taxonomy and redaction rules; it does not change the review.
 */
export default function ReviewFeedback({ kind, review, onClose }: Props) {
  const api = useApi();
  const { data: opts } = useJson<FilterOptions>(kind === "tag" ? "/api/aggregates/filters" : null);
  const [theme, setTheme] = useState(review.themes[0]?.theme ?? (review.sentiment ? "sentiment" : ""));
  const [suggested, setSuggested] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (kind === "tag") {
        await api("/api/feedback/tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewId: review.id, theme: theme || null, suggested: suggested || null, comment: text || null }),
        });
      } else {
        await api("/api/feedback/redaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewId: review.id, note: text || null }),
        });
      }
      setState({ ok: true, msg: "Thanks, recorded for review." });
    } catch (err) {
      setState({ ok: false, msg: (err as Error).message });
    }
  }

  if (state?.ok) {
    return (
      <p role="status" className="mt-2 rounded bg-brand-soft px-3 py-2 text-sm">
        {state.msg} <button type="button" onClick={onClose} className="ml-2 text-brand underline">Close</button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded border border-line bg-canvas p-3 text-sm">
      {kind === "tag" ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1">
              Which tag?
              <select value={theme} onChange={(e) => setTheme(e.target.value)} className="rounded border border-line bg-surface px-1 py-0.5">
                {review.themes.map((t) => <option key={t.theme} value={t.theme}>{t.label}</option>)}
                {review.sentiment && <option value="sentiment">Sentiment ({review.sentiment})</option>}
                <option value="">A theme is missing</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Should be
              <select value={suggested} onChange={(e) => setSuggested(e.target.value)} required={!theme} className="rounded border border-line bg-surface px-1 py-0.5">
                <option value="">{theme ? "Remove this tag" : "Choose a theme"}</option>
                {theme === "sentiment"
                  ? ["positive", "neutral", "negative"].filter((s) => s !== review.sentiment).map((s) => <option key={s} value={s}>{s}</option>)
                  : (opts?.themes ?? []).filter((t) => t.id !== theme).map((t) => <option key={t.id} value={t.id}>{t.label} ({t.vector})</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            Comment (optional)
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="e.g. “mabango” here is sarcastic"
              className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1" />
          </label>
        </>
      ) : (
        <label className="block">
          What kind of personal data was missed?
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. a name without a cue, a Viber number"
            className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1" />
          <span className="mt-0.5 block text-xs text-ink-muted">Describe it; do not copy the personal data itself. An IT officer will check the review.</span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded bg-brand px-3 py-1 text-white">Send</button>
        <button type="button" onClick={onClose} className="text-brand underline">Cancel</button>
        {state && !state.ok && <span role="alert" className="text-negative">{state.msg}</span>}
      </div>
    </form>
  );
}
