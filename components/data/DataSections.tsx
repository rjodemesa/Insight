"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useJson } from "@/components/ui/useJson";
import { num } from "@/components/ui/format";
import DataWorkspace from "./DataWorkspace";
import VerifyQueue from "./VerifyQueue";
import MappingReview from "./MappingReview";
import FeedbackQueue from "./FeedbackQueue";

const SECTIONS = [
  { key: "import", step: 1, label: "Import", hint: "Upload review files and check their quality" },
  { key: "verify", step: 2, label: "Verify reviews", hint: "Confirm labels the tagger is unsure about" },
  { key: "mapping", step: 3, label: "Product mapping", hint: "Merge or split products with similar names" },
  { key: "feedback", step: 4, label: "Feedback", hint: "Tag and redaction problems users reported" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

/** The Data tab as four steps, each on its own page, so the workflow reads left to right. */
export default function DataSections() {
  const sp = useSearchParams();
  const section = (SECTIONS.some((s) => s.key === sp.get("section")) ? sp.get("section") : sp.get("mapping") ? "mapping" : "import") as Section;
  // Default queue size for the step badge (recommended settings, no filters).
  const waiting = useJson<{ total: number }>("/api/verify?threshold=0.31&mixed=true&disagree=true&limit=1");
  return (
    <div className="space-y-4">
      <nav aria-label="Data steps" className="grid gap-2 sm:grid-cols-4">
        {SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <Link key={s.key} href={`/data?section=${s.key}`} aria-current={active ? "page" : undefined}
              className={`rounded-lg border p-3 text-sm ${active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand"}`}>
              <span className="flex items-center gap-2 font-medium">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${active ? "bg-brand text-white" : "bg-canvas text-ink-muted"}`}>{s.step}</span>
                {s.label}
                {s.key === "verify" && waiting.data && waiting.data.total > 0 && (
                  <span className="ml-auto rounded-full bg-[#fff4e5] px-2 text-xs text-[#8a4b00]">{num(waiting.data.total)}</span>
                )}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">{s.hint}</span>
            </Link>
          );
        })}
      </nav>
      {section === "import" && <DataWorkspace />}
      {section === "verify" && <VerifyQueue />}
      {section === "mapping" && <MappingReview />}
      {section === "feedback" && <FeedbackQueue />}
    </div>
  );
}
