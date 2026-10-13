"use client";

import { useState } from "react";
import type { AuditRow } from "@/lib/auditQuery";
import Card from "@/components/ui/Card";
import { useApi, useSession } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { manila, num } from "@/components/ui/format";

interface Page {
  scope: "all" | "own";
  total: number;
  limit: number;
  offset: number;
  entries: AuditRow[];
  actions: { v: string; n: number }[];
  statuses: { v: string; n: number }[];
}
interface Verify {
  ok: boolean;
  brokenAt: number | null;
  checked: number;
  checkedAt: string;
}

const PAGE = 50;
const STATUS_STYLE: Record<string, string> = {
  ok: "text-ink-muted",
  failed: "font-medium text-negative",
  partial: "font-medium text-[#9a6700]",
  not_found: "text-negative",
};
const label = (a: string) => a.replace(/_/g, " ");

/**
 * The append-only audit log. Users see their own actions; IT officers see everyone's, can
 * check the hash chain and export CSV. Times are shown in Manila time; date filters are UTC days.
 */
export default function AuditLog() {
  const api = useApi();
  const { role } = useSession();
  const it = role === "it_officer";
  const [filters, setFilters] = useState({ action: "", status: "", user: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const page = useJson<Page>(`/api/audit?${qs}${qs ? "&" : ""}limit=${PAGE}&offset=${offset}`);
  const users = useJson<{ users: { id: number; email: string }[] }>(it ? "/api/admin/users" : null);
  const [verify, setVerify] = useState<{ busy: boolean; result: Verify | null; error: string | null }>({ busy: false, result: null, error: null });
  const [open, setOpen] = useState<number | null>(null);

  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };

  async function runVerify() {
    setVerify({ busy: true, result: null, error: null });
    try {
      setVerify({ busy: false, result: await api<Verify>("/api/audit/verify"), error: null });
      void page.reload();
    } catch (e) {
      setVerify({ busy: false, result: null, error: (e as Error).message });
    }
  }

  const d = page.data;
  const select = "rounded border border-line bg-surface px-2 py-1 text-sm";
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {it
          ? "Every sign-in, import, export, AI call, decision and admin change by every user. Entries cannot be edited or deleted, and each one is chained to the one before by a hash."
          : "Your own sign-ins, imports, exports, AI requests and decisions. IT officers can see everyone's."}
      </p>

      {it && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 text-sm">
          <button type="button" onClick={runVerify} disabled={verify.busy} className="rounded bg-brand px-3 py-1.5 text-white hover:bg-brand-strong disabled:opacity-50">
            {verify.busy ? "Checking…" : "Verify chain"}
          </button>
          {verify.result && (
            <span role="status" className={verify.result.ok ? "text-positive" : "font-medium text-negative"}>
              {verify.result.ok
                ? `✓ All ${num(verify.result.checked)} entries verified; none altered (${manila(verify.result.checkedAt)}).`
                : `✗ Entry ${verify.result.brokenAt} does not match the chain: the log was changed outside the app.`}
            </span>
          )}
          {verify.error && <span role="alert" className="text-negative">{verify.error}</span>}
          <a href={`/api/audit/export${qs ? `?${qs}` : ""}`} className="ml-auto text-brand underline">Export CSV{qs ? " (filtered)" : ""}</a>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col text-xs">Action
          <select value={filters.action} onChange={(e) => set("action", e.target.value)} className={select}>
            <option value="">All actions</option>
            {d?.actions.map((a) => <option key={a.v} value={a.v}>{label(a.v)} ({num(a.n)})</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs">Status
          <select value={filters.status} onChange={(e) => set("status", e.target.value)} className={select}>
            <option value="">Any</option>
            {d?.statuses.map((s) => <option key={s.v} value={s.v}>{label(s.v)} ({num(s.n)})</option>)}
          </select>
        </label>
        {it && (
          <label className="flex flex-col text-xs">User
            <select value={filters.user} onChange={(e) => set("user", e.target.value)} className={select}>
              <option value="">Everyone</option>
              {users.data?.users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col text-xs">From (UTC)
          <input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className={select} />
        </label>
        <label className="flex flex-col text-xs">To (UTC)
          <input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className={select} />
        </label>
        {qs && <button type="button" onClick={() => { setFilters({ action: "", status: "", user: "", from: "", to: "" }); setOffset(0); }} className="pb-1 text-brand underline">Clear</button>}
      </div>

      <Card title="Entries" subtitle={d ? `${num(d.total)} ${d.scope === "own" ? "of your" : ""} entries, newest first` : undefined}
        loading={page.loading} error={page.error} empty={d && !d.total ? "No entries match these filters." : null}>
        {d && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">When (Manila)</th>
                  {it && <th className="py-1 pr-3 font-medium">User</th>}
                  <th className="py-1 pr-3 font-medium">Action</th>
                  <th className="py-1 pr-3 font-medium">On</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">AI</th>
                  <th className="py-1 font-medium"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.entries.map((e) => (
                  <Row key={e.id} e={e} it={it} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > PAGE && (
          <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded border border-line px-3 py-1 disabled:opacity-40">← Newer</button>
            <span className="text-ink-muted">{num(offset + 1)}–{num(Math.min(offset + PAGE, d.total))} of {num(d.total)}</span>
            <button type="button" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Older →</button>
          </nav>
        )}
      </Card>
    </div>
  );
}

function Row({ e, it, open, onToggle }: { e: AuditRow; it: boolean; open: boolean; onToggle: () => void }) {
  const cols = it ? 8 : 7;
  return (
    <>
      <tr className="align-top">
        <td className="py-1.5 pr-3 text-xs text-ink-muted">{e.id}</td>
        <td className="whitespace-nowrap py-1.5 pr-3">{manila(e.ts)}</td>
        {it && <td className="py-1.5 pr-3">{e.email ?? (e.role === "system" ? "system" : "–")}</td>}
        <td className="py-1.5 pr-3 font-medium">{label(e.action)}</td>
        <td className="py-1.5 pr-3 text-ink-muted">{e.entityType ? `${e.entityType}${e.entityId ? ` ${e.entityId}` : ""}` : "–"}</td>
        <td className={`py-1.5 pr-3 ${STATUS_STYLE[e.status] ?? ""}`}>{label(e.status)}</td>
        <td className="py-1.5 pr-3 text-xs text-ink-muted">{e.aiProvider ? `${e.aiProvider}${e.aiModel && e.aiModel !== e.aiProvider ? ` · ${e.aiModel}` : ""}` : ""}</td>
        <td className="py-1.5 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-xs text-brand underline">{open ? "Hide" : "Details"}</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} className="bg-canvas p-2 text-xs">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {e.details && <><dt className="font-medium">Details</dt><dd><pre className="whitespace-pre-wrap break-all font-mono">{JSON.stringify(e.details, null, 2)}</pre></dd></>}
              {e.ip && <><dt className="font-medium">IP</dt><dd>{e.ip}</dd></>}
              {e.aiVersion && <><dt className="font-medium">Prompt version</dt><dd>{e.aiVersion}</dd></>}
              {e.promptHash && <><dt className="font-medium">Prompt hash</dt><dd className="break-all font-mono">{e.promptHash}</dd></>}
              <dt className="font-medium">Entry hash</dt><dd className="break-all font-mono">{e.hash}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
