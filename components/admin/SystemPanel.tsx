"use client";

import type { Check } from "@/lib/admin/health";
import Card from "@/components/ui/Card";
import { useJson } from "@/components/ui/useJson";
import { manila, num } from "@/components/ui/format";

interface Health {
  checks: Check[];
  stats: Record<string, number | string>;
  checkedAt: string;
}

const ICON = { ok: "✓", warn: "!", fail: "✗" } as const;
const STYLE = { ok: "bg-positive text-white", warn: "bg-[#c98500] text-white", fail: "bg-negative text-white" } as const;
const STAT_LABELS: Record<string, string> = {
  reviews: "Reviews", products: "Products", imports: "Imports", vaultEntries: "Vault entries", users: "Users",
  activeSessions: "Active sessions", auditEntries: "Audit entries", pendingAlerts: "Alerts awaiting decision",
  aiTaggedReviews: "AI-tagged reviews", dbBytes: "Database size", node: "Node.js",
};

export default function SystemPanel() {
  const { data, error, loading, reload } = useJson<Health>("/api/admin/health");
  const fmt = (k: string, v: number | string) => (k === "dbBytes" ? `${(Number(v) / 1024 / 1024).toFixed(1)} MB` : typeof v === "number" ? num(v) : v);
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card title="Checks" subtitle={data ? `Checked ${manila(data.checkedAt)}` : undefined} loading={loading} error={error}
        actions={<button type="button" onClick={reload} className="text-brand underline">Check again</button>}>
        {data && (
          <ul className="divide-y divide-line text-sm">
            {data.checks.map((c) => (
              <li key={c.name} className="flex gap-3 py-2">
                <span aria-label={c.level} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${STYLE[c.level]}`}>{ICON[c.level]}</span>
                <span><span className="font-medium">{c.name}.</span> <span className="text-ink-muted">{c.detail}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Counts" provenance="OBSERVED" loading={loading}>
        {data && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {Object.entries(data.stats).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-muted">{STAT_LABELS[k] ?? k}</dt>
                <dd className="text-right tabular-nums">{fmt(k, v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
