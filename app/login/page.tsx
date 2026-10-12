"use client";

import { useState } from "react";

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
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Consumer Insight Platform</h1>
          <p className="text-sm text-ink-muted">Sign in with your local account.</p>
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
    </main>
  );
}
