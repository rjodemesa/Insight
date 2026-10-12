"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi, useSession } from "@/components/SessionContext";

export interface JobSummary {
  id: number;
  filename: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  processed_rows: number;
  error: string | null;
}

const ACCEPT = ".xlsx,.csv,.gz";
const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** Drag-and-drop upload, then live job progress with a cancel button. */
export default function UploadPanel({ onFinished }: { onFinished: (jobId: number) => void }) {
  const { csrfToken } = useSession();
  const api = useApi();
  const [dragging, setDragging] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Poll the running job once a second until it reaches a terminal state.
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const t = setTimeout(async () => {
      try {
        const { job: next } = await api<{ job: JobSummary }>(`/api/ingest/${job.id}`);
        setJob(next);
        if (TERMINAL.has(next.status)) onFinished(next.id);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [job, api, onFinished]);

  const upload = useCallback(
    (file: File) => {
      setError(null);
      setJob(null);
      setUploadPct(0);
      // XHR rather than fetch: it reports upload progress.
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/ingest");
      xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && setUploadPct(e.loaded / e.total);
      xhr.onload = () => {
        setUploadPct(null);
        const data = JSON.parse(xhr.responseText || "{}") as { jobId?: number; error?: string };
        if (xhr.status >= 300 || !data.jobId) return setError(data.error ?? "Upload failed.");
        setJob({ id: data.jobId, filename: file.name, status: "queued", stage: "queued", progress: 0, processed_rows: 0, error: null });
      };
      xhr.onerror = () => {
        setUploadPct(null);
        setError("Upload failed. Check your connection and try again.");
      };
      xhr.send(file);
    },
    [csrfToken],
  );

  async function cancel() {
    if (!job) return;
    try {
      await api(`/api/ingest/${job.id}/cancel`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const busy = uploadPct !== null || (job !== null && !TERMINAL.has(job.status));
  const pct = uploadPct !== null ? uploadPct : (job?.progress ?? 0);

  return (
    <section aria-labelledby="upload-title" className="rounded-lg border border-line bg-surface p-5">
      <h2 id="upload-title" className="mb-3 text-lg font-semibold">Upload review data</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f && !busy) upload(f);
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? "border-brand bg-brand-soft" : "border-line"}`}
      >
        <p>Drag a file here, or</p>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60">
          Choose file
        </button>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a review data file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <p className="text-sm text-ink-muted">
          .xlsx, .csv or .csv.gz with the standard 32 review columns. Up to 250 MB.
        </p>
      </div>

      {(busy || job) && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span>
              {uploadPct !== null
                ? "Uploading…"
                : job && `${job.filename}: ${job.status === "running" ? job.stage : job.status}`}
              {job && job.processed_rows > 0 && ` · ${job.processed_rows.toLocaleString()} rows`}
            </span>
            <span>{Math.round(pct * 100)}%</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}
            aria-label="Import progress" className="h-2 overflow-hidden rounded bg-canvas">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct * 100}%` }} />
          </div>
          {job && !TERMINAL.has(job.status) && (
            <button type="button" onClick={cancel} className="rounded border border-line px-3 py-1 text-sm hover:bg-canvas">
              Cancel import
            </button>
          )}
          {job?.status === "done" && <p className="text-sm text-positive">Import finished. The quality report is below.</p>}
          {job?.status === "cancelled" && <p className="text-sm text-ink-muted">Import cancelled. No rows were kept.</p>}
          {job?.status === "failed" && <p role="alert" className="text-sm text-negative">{job.error}</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
    </section>
  );
}
