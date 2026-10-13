"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import UsersPanel from "./UsersPanel";
import PiiPanel from "./PiiPanel";
import PurgePanel from "./PurgePanel";
import AiPanel from "./AiPanel";
import SystemPanel from "./SystemPanel";

const TABS = [
  ["system", "System health"], ["users", "Users"], ["pii", "Personal data"], ["ai", "AI"], ["purge", "Purge"],
] as const;
type Tab = (typeof TABS)[number][0];

/** IT-officer tools. The server checks the role on every route; this page is also gated in its layout. */
export default function AdminWorkspace() {
  const sp = useSearchParams();
  const tab = (TABS.some(([t]) => t === sp.get("tab")) ? sp.get("tab") : "system") as Tab;
  return (
    <div className="space-y-4">
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([t, label]) => (
          <Link key={t} href={`/admin?tab=${t}`} aria-current={tab === t ? "page" : undefined}
            className={`-mb-px rounded-t border px-4 py-1.5 text-sm ${tab === t ? "border-line border-b-surface bg-surface font-medium" : "border-transparent text-ink-muted hover:text-ink"} ${t === "purge" ? "text-negative" : ""}`}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "system" && <SystemPanel />}
      {tab === "users" && <UsersPanel />}
      {tab === "pii" && <PiiPanel />}
      {tab === "ai" && <AiPanel />}
      {tab === "purge" && <PurgePanel />}
    </div>
  );
}
