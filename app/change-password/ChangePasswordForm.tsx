"use client";

import { useState } from "react";

export default function ChangePasswordForm({ csrfToken }: { csrfToken: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("newPassword") !== form.get("confirm")) return setError("The new passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not change the password.");
    window.location.assign("/dashboard");
  }

  const field = "mt-1 w-full rounded border border-line px-3 py-2";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Current password
        <input name="currentPassword" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="block text-sm font-medium">
        New password
        <input name="newPassword" type="password" required autoComplete="new-password" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Confirm new password
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60">
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
