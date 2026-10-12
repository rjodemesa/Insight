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
    <header className="bg-brand-strong text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-2 sm:px-6">
        {/* Logo slot: replace public/brand/logo.svg with the official asset. */}
        <img src="/brand/logo.svg" alt="Company logo" width={120} height={32} />
        <span className="font-semibold">Consumer Insight</span>
        <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                title={`${t.label} (g ${t.key})`}
                className={`rounded px-3 py-1.5 text-sm ${active ? "bg-white text-brand-strong" : "hover:bg-white/15"}`}
              >
                <span aria-hidden="true" className="mr-1">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/audit" title="Audit Log (g a)" aria-label="Audit Log" className="rounded px-2 py-1 hover:bg-white/15">
          <span aria-hidden="true">≣</span>
        </Link>
        <span className="text-sm opacity-90">
          {email} · {role === "it_officer" ? "IT officer" : "User"}
        </span>
        <button onClick={logout} className="rounded border border-white/40 px-3 py-1 text-sm hover:bg-white/15">
          Sign out
        </button>
      </div>
    </header>
  );
}
