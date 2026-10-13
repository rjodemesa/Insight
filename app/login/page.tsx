"use client";

import { useState } from "react";
import Disclaimer from "@/components/Disclaimer";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; mustChangePassword?: boolean };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Sign-in failed.");
    window.location.assign(data.mustChangePassword ? "/change-password" : "/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 overflow-hidden rounded-lg border border-line bg-surface p-8 pt-0 shadow-sm">
        <div className="brand-stripe -mx-8 mb-6" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <img src="/brand/logo.svg" alt="P&G" width={48} height={48} />
          <div>
            <h1 className="text-xl font-semibold text-brand">Consumer Insight</h1>
            <p className="text-sm text-ink-muted">P&amp;G Philippines · sign in with your local account</p>
          </div>
        </div>
        <label className="block text-sm font-medium">
          Email
          <input name="email" type="email" required autoComplete="username"
            className="mt-1 w-full rounded border border-line px-3 py-2" />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full rounded border border-line px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <Disclaimer className="max-w-sm" />
    </main>
  );
}
