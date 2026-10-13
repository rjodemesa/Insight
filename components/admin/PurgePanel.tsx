"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { manila, num } from "@/components/ui/format";

interface Overview {
  imports: { id: number; filename: string; status: string; startedAt: string | null; finishedAt: string | null; startedBy: string | null; reviews: number; vaultEntries: number }[];
  vault: { kind: string; n: number }[];
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const VAULT_CONFIRM = "PURGE VAULT";

/** Irreversible deletes. Each needs the exact confirmation text and is audited (the audit log itself is never purged). */
export default function PurgePanel() {
  const api = useApi();
  const data = useJson<Overview>("/api/admin/purge");
  const [confirm, setConfirm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function purge(body: Record<string, unknown>, describe: (r: Record<string, number | string>) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<Record<string, number | string>>("/api/admin/purge", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      setNotice(describe(r));
      setConfirm({});
      void data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const images = data.data?.vault.find((v) => v.kind === "IMAGE")?.n ?? 0;
  const vaultTotal = data.data?.vault.reduce((s, v) => s + v.n, 0) ?? 0;
  const input = "rounded border border-line px-2 py-1 text-sm";
  return (
    <div className="space-y-4">
      <p role="note" className="rounded border border-negative/40 bg-surface p-3 text-sm">
        <span className="font-medium text-negative">Everything on this tab is permanent.</span> There is no undo and no backup is made. Copy <code>data/prism.db</code> first if you might need the data again. The audit log keeps a record of every purge.
      </p>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      {notice && <p role="status" className="text-sm text-positive">{notice}</p>}

      <Card title="Delete an import" loading={data.loading} error={data.error}
        subtitle="Removes the import's reviews with their tags, vault entries and feedback, and products left with no reviews. Type the file name to confirm."
        empty={data.data && !data.data.imports.length ? "No imports." : null}>
        {data.data && (
          <ul className="divide-y divide-line text-sm">
            {data.data.imports.map((j) => {
              const key = `import-${j.id}`;
              return (
                <li key={j.id} className="flex flex-wrap items-end gap-2 py-2">
                  <div className="min-w-60 flex-1">
                    <p className="font-medium">{j.filename}</p>
                    <p className="text-xs text-ink-muted">
                      {j.status} · {num(j.reviews)} reviews · {num(j.vaultEntries)} vault entries · {j.startedBy ?? "unknown"} · {manila(j.finishedAt ?? j.startedAt)}
                    </p>
                  </div>
                  <label className="flex flex-col text-xs">Type <code>{j.filename}</code>
                    <input value={confirm[key] ?? ""} onChange={(e) => setConfirm({ ...confirm, [key]: e.target.value })} className={input} />
                  </label>
                  <button type="button" disabled={busy || confirm[key] !== j.filename}
                    onClick={() => void purge({ target: "import", id: j.id, confirm: confirm[key] }, (r) => `Deleted ${r.filename}: ${num(Number(r.reviews))} reviews, ${num(Number(r.vaultEntries))} vault entries, ${num(Number(r.products))} products.`)}
                    className="rounded bg-negative px-3 py-1.5 text-white disabled:opacity-40">Delete import</button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Purge the PII vault" loading={data.loading}
        subtitle="Deletes encrypted originals so redaction becomes permanent: tokens stay in the text, and reveal and restore stop working for those values.">
        <div className="space-y-3 text-sm">
          <p className="text-ink-muted">The vault holds {num(vaultTotal)} entries, {num(images)} of them customer image links.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs">Type <code>{VAULT_CONFIRM}</code>
              <input value={confirm.vault ?? ""} onChange={(e) => setConfirm({ ...confirm, vault: e.target.value })} className={input} />
            </label>
            <button type="button" disabled={busy || confirm.vault !== VAULT_CONFIRM || !images}
              onClick={() => void purge({ target: "vault", scope: "images", confirm: VAULT_CONFIRM }, (r) => `Deleted ${num(Number(r.deleted))} customer image links from the vault.`)}
              className="rounded border border-negative px-3 py-1.5 text-negative disabled:opacity-40">Purge image links only</button>
            <button type="button" disabled={busy || confirm.vault !== VAULT_CONFIRM || !vaultTotal}
              onClick={() => void purge({ target: "vault", scope: "all", confirm: VAULT_CONFIRM }, (r) => `Deleted all ${num(Number(r.deleted))} vault entries. Redaction is now permanent.`)}
              className="rounded bg-negative px-3 py-1.5 text-white disabled:opacity-40">Purge the whole vault</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
