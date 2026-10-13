"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { num } from "@/components/ui/format";

interface AiInfo {
  provider: string;
  model: string;
  label: string;
  configured: boolean;
  promptVersion: string;
  usage: { action: string; status: string; calls: number; promptTokens: number; outputTokens: number }[];
}

/** AI settings are read-only here: the provider, model and key live in .env.local. */
export default function AiPanel() {
  const api = useApi();
  const info = useJson<AiInfo>("/api/admin/ai");
  const [test, setTest] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: false });

  async function runTest() {
    setTest({ busy: true, text: null, ok: false });
    try {
      const r = await api<{ ok: boolean; label: string; ms: number }>("/api/admin/ai/test", { method: "POST" });
      setTest({ busy: false, ok: r.ok, text: r.ok ? `✓ ${r.label} answered in ${num(r.ms)} ms.` : `${r.label} answered, but not as expected.` });
    } catch (e) {
      setTest({ busy: false, ok: false, text: (e as Error).message });
    } finally {
      void info.reload();
    }
  }

  const d = info.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Settings in use" loading={info.loading} error={info.error}
        subtitle="Change these in .env.local and restart the server. The key is never stored in the database or shown here.">
        {d && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-ink-muted">Provider</dt><dd>{d.provider === "gemini" ? "Google Gemini" : "Mock (offline, no real model)"}</dd>
              <dt className="text-ink-muted">Model</dt><dd className="font-mono">{d.model}</dd>
              <dt className="text-ink-muted">API key</dt><dd>{d.provider === "mock" ? "Not needed" : d.configured ? "Set in .env.local" : <span className="text-negative">Missing: set GEMINI_API_KEY</span>}</dd>
              <dt className="text-ink-muted">Prompt version</dt><dd>{d.promptVersion}</dd>
            </dl>
            <pre className="rounded bg-canvas p-2 text-xs">{`AI_PROVIDER=gemini\nGEMINI_API_KEY=<key from Google AI Studio>\nGEMINI_MODEL=${d.provider === "gemini" ? d.model : "gemini-3.8-flash"}   # optional`}</pre>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runTest} disabled={test.busy} className="rounded bg-brand px-3 py-1.5 text-white hover:bg-brand-strong disabled:opacity-50">
                {test.busy ? "Testing…" : "Test connection"}
              </button>
              {test.text && <span role="status" className={test.ok ? "text-positive" : "text-negative"}>{test.text}</span>}
            </div>
            <p className="text-xs text-ink-muted">The test sends one tiny request with no review data and is audited.</p>
          </div>
        )}
      </Card>
      <Card title="AI calls in the last 7 days" provenance="OBSERVED" loading={info.loading}
        subtitle="From the audit log. Token counts are reported by Gemini; the mock reports none."
        empty={d && !d.usage.length ? "No AI calls yet." : null}>
        {d && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr><th className="py-1 font-medium">Action</th><th className="py-1 font-medium">Status</th><th className="py-1 text-right font-medium">Calls</th><th className="py-1 text-right font-medium">Tokens in / out</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.usage.map((u) => (
                <tr key={`${u.action}-${u.status}`}>
                  <td className="py-1">{u.action.replace(/_/g, " ")}</td>
                  <td className={`py-1 ${u.status === "ok" ? "" : "text-negative"}`}>{u.status}</td>
                  <td className="py-1 text-right tabular-nums">{num(u.calls)}</td>
                  <td className="py-1 text-right tabular-nums">{u.promptTokens || u.outputTokens ? `${num(u.promptTokens)} / ${num(u.outputTokens)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
