"use client";

import Link from "next/link";
import type { Finding } from "@/lib/insights/derive";
import Card from "@/components/ui/Card";
import { drillHref } from "@/components/filters/useFilters";

const ICON: Record<Finding["kind"], string> = {
  overview: "◎", issue: "⚠", rising: "▲", falling: "▼", retailer: "⇄", conflict: "≠", data: "ⓘ",
};

/**
 * Plain-language summary built by fixed rules from the numbers on this page (DERIVED).
 * Phase 4 adds an AI-written summary grounded in these same facts.
 */
export default function KeyFindings({ findings, query, loading }: { findings: Finding[] | null; query: string; loading: boolean }) {
  return (
    <Card title="Key findings" provenance="DERIVED" loading={loading && !findings}
      subtitle="Written by fixed rules from the numbers on this page, not by AI. Every figure states its sample size.">
      {findings && (
        <ul className="space-y-1.5 text-sm">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-ink-muted">{ICON[f.kind]}</span>
              <span className="flex-1">
                {f.text}{" "}
                {f.drill && (
                  <Link href={drillHref(query, { ...f.drill, view: "reviews" })} className="whitespace-nowrap text-brand underline">
                    Read reviews
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
