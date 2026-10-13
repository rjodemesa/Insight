"use client";

import Link from "next/link";
import { useState } from "react";
import type { RevealedRecord } from "@/lib/redact/vault";
import Card from "@/components/ui/Card";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { manila, num } from "@/components/ui/format";
import { reviewHref } from "@/components/ai/Cited";

interface Overview {
  vault: { kind: string; n: number }[];
  flags: { id: number; reviewId: number; note: string | null; createdAt: string; user: string | null; redactions: number | null }[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Reveal decrypts one review's originals for an IT officer (reason required, audited).
 * Restore puts chosen originals back into the stored text for everyone: for false positives only.
 */
export default function PiiPanel() {
  const api = useApi();
  const overview = useJson<Overview>("/api/admin/pii");
  const [reviewId, setReviewId] = useState("");
  const [reason, setReason] = useState("");
  const [record, setRecord] = useState<RevealedRecord | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reveal(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setRecord(null);
    setChosen([]);
    try {
      const r = await api<{ record: RevealedRecord }>("/api/admin/pii/reveal", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ reviewId: Number(reviewId), reason }) });
      setRecord(r.record);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!record || !chosen.length) return;
    if (!window.confirm(`Put ${chosen.length} original value(s) back into review ${record.reviewId}? Every user, export and AI request will see them. This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/pii/restore", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ reviewId: record.reviewId, tokens: chosen, reason }) });
      setNotice(`Restored ${chosen.length} value(s) in review ${record.reviewId}. The review was re-tagged.`);
      setRecord(null);
      setChosen([]);
      void overview.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const restorable = record?.tokens.filter((t) => t.kind !== "IMAGE") ?? [];
  const input = "rounded border border-line px-2 py-1 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <Card title="Reveal a record" subtitle="Decrypts one review's redacted originals. Requires a reason; every reveal is audited with it.">
          <form onSubmit={reveal} className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col text-xs">Review id
              <input inputMode="numeric" required value={reviewId} onChange={(e) => setReviewId(e.target.value.replace(/\D/g, ""))} className={`${input} w-28`} />
            </label>
            <label className="flex flex-1 flex-col text-xs">Reason (at least 10 characters)
              <input required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={input}
                placeholder="e.g. Checking a missed-redaction flag from the review viewer" />
            </label>
            <button type="submit" disabled={busy || !reviewId || reason.trim().length < 10} className="rounded bg-brand px-3 py-1.5 text-white hover:bg-brand-strong disabled:opacity-50">Reveal</button>
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-negative">{error}</p>}
          {notice && <p role="status" className="mt-2 text-sm text-positive">{notice}</p>}
          {record && (
            <div className="mt-3 space-y-3 rounded border border-negative/40 bg-canvas p-3 text-sm">
              <p className="text-xs font-medium text-negative">Personal data: do not copy or share. Close this panel when done.</p>
              {record.reviewTitle && <p className="font-medium">{record.reviewTitle}</p>}
              <p className="whitespace-pre-line">{record.reviewText ?? <em className="text-ink-muted">No text.</em>}</p>
              {record.customerImages.length > 0 && (
                <p className="text-xs text-ink-muted">{record.customerImages.length} customer image link(s) are in the vault. They are never shown.</p>
              )}
              {restorable.length > 0 ? (
                <fieldset className="space-y-1">
                  <legend className="text-xs font-medium">Wrongly redacted? Tick the tokens that are not personal data to restore them for everyone.</legend>
                  {restorable.map((t) => (
                    <label key={t.token} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={chosen.includes(t.token)}
                        onChange={(e) => setChosen(e.target.checked ? [...chosen, t.token] : chosen.filter((x) => x !== t.token))} />
                      <code>{t.token}</code> <span className="text-ink-muted">{t.kind.toLowerCase()} in {t.field === "reviewTitle" ? "title" : "text"}</span>
                    </label>
                  ))}
                  <div className="flex gap-3 pt-1">
                    <button type="button" disabled={busy || !chosen.length} onClick={restore} className="rounded border border-negative px-3 py-1 text-negative hover:bg-surface disabled:opacity-40">
                      Restore {chosen.length || ""} selected
                    </button>
                    <button type="button" onClick={() => { setRecord(null); setChosen([]); }} className="text-brand underline">Close</button>
                  </div>
                </fieldset>
              ) : (
                <button type="button" onClick={() => setRecord(null)} className="text-brand underline">Close</button>
              )}
            </div>
          )}
        </Card>

        <Card title="Missed personal data flags" loading={overview.loading} error={overview.error}
          subtitle="Reviews users marked with “Missed personal info?”. Reveal the record to check it."
          empty={overview.data && !overview.data.flags.length ? "No flags." : null}>
          {overview.data && (
            <ul className="divide-y divide-line text-sm">
              {overview.data.flags.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Link href={reviewHref(f.reviewId)} className="font-medium text-brand underline">Review {f.reviewId}</Link>
                  <span className="text-xs text-ink-muted">{f.user ?? "unknown"} · {manila(f.createdAt)} · {num(f.redactions ?? 0)} token(s)</span>
                  {f.note && <span className="w-full text-xs">“{f.note}”</span>}
                  <button type="button" onClick={() => setReviewId(String(f.reviewId))} className="ml-auto text-xs text-brand underline">Use this id</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Vault contents" provenance="OBSERVED" loading={overview.loading}
        subtitle="Encrypted originals by kind (AES-256-GCM). Purge them on the Purge tab to make redaction permanent.">
        {overview.data && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {overview.data.vault.length === 0 && <p className="text-ink-muted">Empty.</p>}
            {overview.data.vault.map((v) => (
              <div key={v.kind} className="contents">
                <dt className="text-ink-muted">{v.kind === "IMAGE" ? "Customer image links" : v.kind.charAt(0) + v.kind.slice(1).toLowerCase()}</dt>
                <dd className="text-right tabular-nums">{num(v.n)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
