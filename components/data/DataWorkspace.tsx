"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/components/SessionContext";
import type { QualityReport as Report } from "@/lib/ingest/quality";
import QualityReport from "./QualityReport";
import UploadPanel from "./UploadPanel";

interface HistoryRow {
  id: number;
  filename: string;
  status: string;
  processed_rows: number;
  file_bytes: number | null;
  started_at: string | null;
  finished_at: string | null;
  started_by: string | null;
  error: string | null;
}

const manila = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "–";

const duration = (a: string | null, b: string | null) =>
  a && b ? `${Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000))} s` : "–";

export default function DataWorkspace() {
  const api = useApi();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selected, setSelected] = useState<{ filename: string; report: Report; formula: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await api<{ jobs: HistoryRow[] }>("/api/ingest")).jobs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  const showReport = useCallback(
    async (id: number) => {
      try {
        const d = await api<{ job: { filename: string }; quality: Report | null; qualityFormula: string }>(`/api/ingest/${id}`);
        setSelected(d.quality ? { filename: d.job.filename, report: d.quality, formula: d.qualityFormula } : null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api],
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Show the latest successful import's report on first load.
  useEffect(() => {
    if (selected) return;
    const latest = history.find((h) => h.status === "done");
    if (latest) void showReport(latest.id);
  }, [history, selected, showReport]);

  const onFinished = useCallback(
    (id: number) => {
      void loadHistory();
      void showReport(id);
    },
    [loadHistory, showReport],
  );

  return (
    <>
      <UploadPanel onFinished={onFinished} />

      <aside className="rounded-lg border border-line bg-brand-soft p-4 text-sm">
        <strong>Redaction coverage.</strong> Emails, PH phone numbers, order and tracking numbers, links and
        @handles, barangay and street cues, and names introduced by phrases like &ldquo;ako si&rdquo; or
        &ldquo;my name is&rdquo; are replaced with tokens such as [PHONE_001] before anything is stored. Detection is
        best-effort: names without a cue, especially in Taglish, can be missed. Originals are kept encrypted and only an
        IT officer can reveal them, with a recorded reason. Customer image links are never shown, only counted.
      </aside>

      {selected && <QualityReport {...selected} />}

      <section aria-labelledby="history-title" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="history-title" className="mb-3 text-lg font-semibold">Import history</h2>
        {error && <p role="alert" className="mb-2 text-sm text-negative">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-2 pr-3">File</th><th className="pr-3">Status</th><th className="pr-3 text-right">Rows</th>
                <th className="pr-3">Started (Manila)</th><th className="pr-3">Time taken</th><th className="pr-3">By</th><th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="py-2 pr-3">{h.filename}</td>
                  <td className="pr-3">
                    <span className={h.status === "failed" ? "text-negative" : h.status === "done" ? "text-positive" : ""}>{h.status}</span>
                    {h.error && <div className="text-xs text-ink-muted">{h.error}</div>}
                  </td>
                  <td className="pr-3 text-right tabular-nums">{h.processed_rows.toLocaleString()}</td>
                  <td className="pr-3">{manila(h.started_at)}</td>
                  <td className="pr-3">{duration(h.started_at, h.finished_at)}</td>
                  <td className="pr-3">{h.started_by ?? "–"}</td>
                  <td>
                    {h.status === "done" && (
                      <button type="button" onClick={() => showReport(h.id)} className="text-brand underline">
                        View report
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-ink-muted">No imports yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
