"use client";

import { useState } from "react";
import type { UserRow } from "@/lib/admin/users";
import Card from "@/components/ui/Card";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { manila } from "@/components/ui/format";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Shows a temporary password once, with a copy button. It is not stored anywhere readable. */
function OneTimePassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded border border-brand bg-brand-soft p-3 text-sm">
      <p>Temporary password for <span className="font-medium">{email}</span>. It is shown only once; give it to the user privately. They must change it when they sign in.</p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-surface px-2 py-1 font-mono text-base">{password}</code>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(password).then(() => setCopied(true)); }} className="text-brand underline">{copied ? "Copied" : "Copy"}</button>
        <button type="button" onClick={onClose} className="ml-auto text-brand underline">Done</button>
      </div>
    </div>
  );
}

export default function UsersPanel() {
  const api = useApi();
  const list = useJson<{ users: UserRow[]; you: number }>("/api/admin/users");
  const [form, setForm] = useState({ email: "", displayName: "", role: "user" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  async function call<T>(url: string, init: RequestInit, after?: (r: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(url, init);
      after?.(r);
      void list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void call<{ email: string; temporaryPassword: string }>("/api/admin/users", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(form) }, (r) => {
      setSecret({ email: r.email, password: r.temporaryPassword });
      setForm({ email: "", displayName: "", role: "user" });
    });
  };
  const patch = (id: number, body: Record<string, unknown>) => call(`/api/admin/users/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const reset = (u: UserRow) => {
    if (!window.confirm(`Reset the password for ${u.email}? Their sessions end and they get a new temporary password.`)) return;
    void call<{ email: string; temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, { method: "POST" }, (r) => setSecret({ email: r.email, password: r.temporaryPassword }));
  };

  const input = "rounded border border-line px-2 py-1 text-sm";
  return (
    <div className="space-y-4">
      {secret && <OneTimePassword {...secret} onClose={() => setSecret(null)} />}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}

      <Card title="Add a user" subtitle="New users get a one-time temporary password and must change it at first sign-in.">
        <form onSubmit={create} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col text-xs">Email
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          </label>
          <label className="flex flex-col text-xs">Name (optional)
            <input value={form.displayName} maxLength={80} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={input} />
          </label>
          <label className="flex flex-col text-xs">Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
              <option value="user">User</option>
              <option value="it_officer">IT officer</option>
            </select>
          </label>
          <button type="submit" disabled={busy} className="rounded bg-brand px-3 py-1.5 text-white hover:bg-brand-strong disabled:opacity-50">Add user</button>
        </form>
      </Card>

      <Card title="Accounts" loading={list.loading} error={list.error}
        subtitle="Changing a role or disabling an account signs that user out everywhere. You cannot change your own role or disable yourself, and there must always be one active IT officer.">
        {list.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Email</th>
                  <th className="py-1 pr-3 font-medium">Role</th>
                  <th className="py-1 pr-3 font-medium">State</th>
                  <th className="py-1 pr-3 font-medium">Last sign-in</th>
                  <th className="py-1 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.users.map((u) => {
                  const self = u.id === list.data!.you;
                  return (
                    <tr key={u.id} className={u.disabled ? "text-ink-muted" : ""}>
                      <td className="py-1.5 pr-3">
                        {u.email}{self && <span className="ml-1 text-xs text-ink-muted">(you)</span>}
                        {u.displayName && <span className="block text-xs text-ink-muted">{u.displayName}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <select aria-label={`Role for ${u.email}`} value={u.role} disabled={busy || self} onChange={(e) => void patch(u.id, { role: e.target.value })}
                          className="rounded border border-line px-1 py-0.5 text-sm disabled:opacity-60">
                          <option value="user">User</option>
                          <option value="it_officer">IT officer</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-3 text-xs">
                        {u.disabled ? "Disabled" : u.mustChangePassword ? "Must change password" : "Active"}
                        {u.activeSessions > 0 && <span className="block text-ink-muted">{u.activeSessions} active session(s)</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-xs">{u.lastSignIn ? manila(u.lastSignIn) : "Never"}</td>
                      <td className="space-x-3 whitespace-nowrap py-1.5 text-right text-xs">
                        {!self && <button type="button" disabled={busy} onClick={() => reset(u)} className="text-brand underline">Reset password</button>}
                        {!self && (
                          <button type="button" disabled={busy} onClick={() => void patch(u.id, { disabled: !u.disabled })} className={u.disabled ? "text-brand underline" : "text-negative underline"}>
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
