"use client";

import Link from "next/link";
import { useState } from "react";
import type { AlertRow, AlertStatus, ScanStats } from "@/lib/agent/alerts";
import Card from "@/components/ui/Card";
import ProvenanceBadge from "@/components/ProvenanceBadge";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { day, manila } from "@/components/ui/format";
import { drillHref } from "@/components/filters/useFilters";
import Cited, { FactList, reviewHref } from "@/components/ai/Cited";

interface List {
  alerts: AlertRow[];
  counts: Record<AlertStatus, number>;
}

const TABS: [AlertStatus, string][] = [["proposed", "Proposed"], ["approved", "Approved"], ["dismissed", "Dismissed"]];
export const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-negative text-white",
  medium: "bg-[#c98500] text-white",
  low: "bg-canvas text-ink-muted border border-line",
};

/**
 * The agent's proposals. A fixed statistical rule finds each change (DERIVED); the AI only
 * writes the description and next step (AI). Nothing is an alert until someone approves it.
 */
export default function AlertsWorkspace() {
  const api = useApi();
  const [tab, setTab] = useState<AlertStatus>("proposed");
  const list = useJson<List>(`/api/alerts?status=${tab}`);
  const [scan, setScan] = useState<{ busy: boolean; result: ScanStats | null; error: string | null }>({ busy: false, result: null, error: null });

  async function runAgent() {
    setScan({ busy: true, result: null, error: null });
    try {
      const result = await api<ScanStats>("/api/alerts/scan", { method: "POST" });
      setScan({ busy: false, result, error: null });
      setTab("proposed");
      void list.reload();
    } catch (e) {
      setScan({ busy: false, result: null, error: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Alert status" className="flex gap-1">
          {TABS.map(([s, label]) => (
            <button key={s} type="button" onClick={() => setTab(s)} aria-pressed={tab === s}
              className={`rounded border px-3 py-1 text-sm ${tab === s ? "border-brand bg-brand-soft font-medium" : "border-line bg-surface"}`}>
              {label} {list.data && <span className="text-ink-muted">({list.data.counts[s]})</span>}
            </button>
          ))}
        </nav>
        <button type="button" onClick={runAgent} disabled={scan.busy}
          className="ml-auto rounded bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-strong disabled:opacity-50">
          {scan.busy ? "Scanning…" : "Run agent now"}
        </button>
      </div>
      {scan.error && <p role="alert" className="text-sm text-negative">{scan.error}</p>}
      {scan.result && (
        <p role="status" className="text-sm text-ink-muted">
          Found {scan.result.detected} change(s); {scan.result.alreadyProposed} already proposed earlier; {scan.result.created} new.
          {scan.result.aiError && ` The AI write-up failed (${scan.result.aiError}), so new alerts use rule-written text.`}
        </p>
      )}
      {list.error && <p role="alert" className="text-sm text-negative">{list.error}</p>}
      {list.data && list.data.alerts.length === 0 && (
        <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-muted">
          {tab === "proposed" ? "No alerts waiting for a decision. Run the agent to check the latest data." : `No ${tab} alerts.`}
        </p>
      )}
      <div className="space-y-3">
        {list.data?.alerts.map((a) => <AlertCard key={a.id} a={a} onDecided={list.reload} />)}
      </div>
    </div>
  );
}

function AlertCard({ a, onDecided }: { a: AlertRow; onDecided: () => void }) {
  const api = useApi();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ai = a.writtenBy && a.writtenBy !== "rules";

  async function decide(decision: "approve" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/alerts/${a.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }) });
      onDecided();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card
      title={a.title}
      provenance={ai ? "AI" : "DERIVED"}
      subtitle={`Proposed ${manila(a.createdAt)} · detected by a fixed statistical rule · written by ${a.writtenBy === "rules" || !a.writtenBy ? "rules (no AI)" : a.writtenBy === "mock" ? "mock AI" : a.writtenBy}`}
      actions={<span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLE[a.severity]}`}>{a.severity}</span>}
    >
      <div className="space-y-2 text-sm">
        {a.description && <p><Cited text={a.description} facts={a.evidence.facts} /></p>}
        {a.recommendation && <p><span className="font-medium">Suggested next step:</span> {a.recommendation}</p>}
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href={drillHref("", { ...a.drill, view: "reviews" })} className="text-brand underline">Read the reviews behind this</Link>
          <button type="button" onClick={() => setOpen(!open)} className="text-brand underline">{open ? "Hide" : "Show"} evidence</button>
        </div>
        {open && (
          <div className="space-y-2 rounded border border-line bg-canvas p-2">
            <p className="text-xs font-medium">Evidence <ProvenanceBadge kind="DERIVED" /></p>
            <FactList facts={a.evidence.facts} />
            {a.evidence.reviews.length > 0 && (
              <ul className="space-y-1 text-xs">
                {a.evidence.reviews.map((r) => (
                  <li key={r.id}>
                    <Link href={reviewHref(r.id)} className="font-medium text-brand underline">R{r.id}</Link>{" "}
                    <span className="text-ink-muted">{[day(r.date), r.rating !== null ? `${r.rating}★` : null, r.retailer, r.brand].filter(Boolean).join(" · ")}</span>{" "}
                    {r.text.length > 240 ? `${r.text.slice(0, 240)}…` : r.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {a.status === "proposed" ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <label className="flex flex-1 flex-col text-xs">
              Note (optional): why approve or dismiss
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-0.5 rounded border border-line px-2 py-1 text-sm" />
            </label>
            <button type="button" disabled={busy} onClick={() => decide("approve")} className="rounded bg-brand px-3 py-1.5 text-white hover:bg-brand-strong disabled:opacity-50">Approve</button>
            <button type="button" disabled={busy} onClick={() => decide("dismiss")} className="rounded border border-line px-3 py-1.5 hover:bg-canvas disabled:opacity-50">Dismiss</button>
          </div>
        ) : (
          <p className="border-t border-line pt-2 text-xs text-ink-muted">
            {a.status === "approved" ? "Approved" : "Dismissed"} by {a.decidedBy ?? "unknown"} on {manila(a.decidedAt)}{a.decisionNote ? `: “${a.decisionNote}”` : "."}
          </p>
        )}
        {error && <p role="alert" className="text-xs text-negative">{error}</p>}
      </div>
    </Card>
  );
}

/** Approved alerts on the Dashboard, so the team sees what has been confirmed. */
export function ActiveAlerts() {
  const { data } = useJson<List>("/api/alerts?status=approved");
  if (!data?.alerts.length) return null;
  return (
    <section aria-label="Approved alerts" className="rounded-lg border border-negative/40 bg-surface p-3">
      <h2 className="mb-1 text-sm font-semibold">Approved alerts ({data.alerts.length})</h2>
      <ul className="space-y-1 text-sm">
        {data.alerts.slice(0, 3).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[a.severity]}`}>{a.severity}</span>
            <span>{a.title}</span>
            <Link href={drillHref("", { ...a.drill, view: "reviews" })} className="text-xs text-brand underline">Read reviews</Link>
          </li>
        ))}
      </ul>
      {data.alerts.length > 3 && <Link href="/alerts" className="text-xs text-brand underline">All alerts</Link>}
    </section>
  );
}
