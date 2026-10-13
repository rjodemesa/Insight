"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Role } from "@/lib/auth/session";

interface Tab {
  href: string;
  label: string;
  icon: string;
  /** Second key of the "g <key>" shortcut. */
  key: string;
  itOnly?: boolean;
}

export const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", key: "d" },
  { href: "/data", label: "Data", icon: "⇪", key: "u" },
  { href: "/insights", label: "Insights", icon: "◎", key: "i" },
  { href: "/ask", label: "Ask AI", icon: "✦", key: "k" },
  { href: "/alerts", label: "Alerts", icon: "⚑", key: "l" },
  { href: "/audit", label: "Audit Log", icon: "≣", key: "a" },
  { href: "/admin", label: "Admin", icon: "⚙", key: "m", itOnly: true },
];

export default function AppNav({ role, email, csrfToken }: { role: Role; email: string; csrfToken: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = TABS.filter((t) => !t.itOnly || role === "it_officer");

  // "g" then a letter jumps to a tab (e.g. g a = Audit Log). Ignored while typing in a field.
  useEffect(() => {
    let pendingG = 0;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (e.key === "g") {
        pendingG = Date.now();
        return;
      }
      if (Date.now() - pendingG < 1000) {
        const tab = tabs.find((t) => t.key === e.key);
        if (tab) router.push(tab.href);
      }
      pendingG = 0;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, tabs]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    window.location.assign("/login");
  }

  return (
    <header className="border-b border-line bg-surface text-ink">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-2 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="P&G Consumer Insight, go to Dashboard">
          <img src="/brand/logo.svg" alt="" width={36} height={36} />
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-brand">Consumer Insight</span>
            <span className="block text-[11px] text-ink-muted">P&amp;G Philippines</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                title={`${t.label} (g ${t.key})`}
                className={`rounded px-3 py-1.5 text-sm ${active ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"}`}
              >
                <span aria-hidden="true" className="mr-1">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/audit" title="Audit Log (g a)" aria-label="Audit Log" className="rounded px-2 py-1 text-ink-muted hover:bg-brand-soft">
          <span aria-hidden="true">≣</span>
        </Link>
        <span className="text-sm text-ink-muted">
          {email} · {role === "it_officer" ? "IT officer" : "User"}
        </span>
        <button onClick={logout} className="rounded border border-line px-3 py-1 text-sm hover:bg-brand-soft">
          Sign out
        </button>
      </div>
      <div className="brand-stripe" aria-hidden="true" />
    </header>
  );
}
