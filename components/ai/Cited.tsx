"use client";

import Link from "next/link";
import type { Fact } from "@/lib/ai/grounding";
import { drillHref } from "@/components/filters/useFilters";

/** Link to one review in the review viewer. */
export const reviewHref = (id: number) => `/insights?review=${id}&includeDuplicates=true&view=reviews`;

/**
 * AI text with its citations as chips: [F3] shows the computed fact on hover and opens the
 * reviews behind it; [R123] opens that review. The server has already removed markers that
 * did not point at supplied facts or reviews.
 */
export default function Cited({ text, facts, query = "" }: { text: string; facts: Fact[]; query?: string }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const parts = text.split(/(\[(?:F\d+|R\d+)\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(F\d+|R(\d+))\]$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        if (m[2]) {
          return (
            <Link key={i} href={reviewHref(Number(m[2]))} title={`Open review ${m[2]}`}
              className="mx-0.5 inline-block rounded bg-canvas px-1 text-[11px] font-medium text-brand no-underline hover:underline">
              R{m[2]}
            </Link>
          );
        }
        const fact = byId.get(m[1]!);
        const label = <>{m[1]}</>;
        const cls = "mx-0.5 inline-block rounded border border-derived/40 px-1 text-[11px] font-medium text-derived no-underline";
        return fact?.drill ? (
          <Link key={i} href={drillHref(query, { ...fact.drill, view: "reviews" })} title={`DERIVED fact: ${fact.text}`} className={`${cls} hover:underline`}>
            {label}
          </Link>
        ) : (
          <abbr key={i} title={fact ? `DERIVED fact: ${fact.text}` : undefined} className={`${cls} cursor-help`}>{label}</abbr>
        );
      })}
    </>
  );
}

/** The numbered facts the AI was given, so every citation can be checked. */
export function FactList({ facts, cited, query = "" }: { facts: Fact[]; cited?: Set<string>; query?: string }) {
  const shown = cited ? facts.filter((f) => cited.has(f.id)) : facts;
  if (!shown.length) return null;
  return (
    <ul className="space-y-1 text-xs text-ink-muted">
      {shown.map((f) => (
        <li key={f.id} className="flex gap-2">
          <span className="w-8 shrink-0 font-medium text-derived">{f.id}</span>
          <span>
            {f.text}{" "}
            {f.drill && <Link href={drillHref(query, { ...f.drill, view: "reviews" })} className="whitespace-nowrap text-brand underline">Read reviews</Link>}
          </span>
        </li>
      ))}
    </ul>
  );
}
