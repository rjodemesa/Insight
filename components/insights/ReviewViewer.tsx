"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReviewRow } from "@/lib/insights/queries";
import Card from "@/components/ui/Card";
import { day, num } from "@/components/ui/format";
import { useFilters, withQuery } from "@/components/filters/useFilters";
import { useJson } from "@/components/ui/useJson";
import { ExportLink } from "@/components/charts/common";
import ProvenanceBadge from "@/components/ProvenanceBadge";
import ReviewFeedback from "./ReviewFeedback";
import RatingFilter from "@/components/filters/RatingFilter";

interface Tag {
  theme: string;
  label: string;
  vector: string;
  sentiment: string | null;
  confidence: number | null;
  source: string;
}
type Review = ReviewRow & { themes: Tag[] };
interface Page {
  total: number;
  limit: number;
  offset: number;
  reviews: Review[];
  note: string;
}

const SORTS = [
  ["newest", "Newest"], ["helpful", "Most helpful"], ["rating_low", "Lowest rating"], ["rating_high", "Highest rating"], ["oldest", "Oldest"],
] as const;
const PAGE = 20;
const SENTIMENT_STYLE: Record<string, string> = {
  positive: "border-[#2a78d6] text-[#1c5cab]",
  neutral: "border-[#898781] text-ink-muted",
  negative: "border-[#e34948] text-negative",
};

/** Redacted reviews for the current filters, with tags, provenance and feedback buttons. */
export default function ReviewViewer({ extra = "", title = "Reviews" }: { extra?: string; title?: string }) {
  const f = useFilters();
  const sort = f.get("sort") ?? "newest";
  const offset = Math.max(0, Number(f.get("offset") ?? 0) || 0);
  const scope = [f.query, extra].filter(Boolean).join("&");
  const url = `/api/reviews${withQuery([scope, `sort=${sort}`, `limit=${PAGE}`, `offset=${offset}`].filter(Boolean).join("&"))}`;
  const { data, error, loading } = useJson<Page>(url);
  const pages = data ? Math.ceil(data.total / PAGE) : 0;
  const pageNo = Math.floor(offset / PAGE) + 1;

  return (
    <div className="space-y-3">
      <RatingFilter />
      <Card
        title={title}
        provenance="OBSERVED"
        subtitle={data ? `${num(data.total)} reviews. ${data.note}` : undefined}
        loading={loading}
        error={error}
        empty={data && !data.total ? "No reviews match these filters." : null}
        actions={
          <>
            <label className="flex items-center gap-1 text-xs">
              Sort
              <select value={sort} onChange={(e) => { f.set("sort", e.target.value); }} className="rounded border border-line px-1 py-0.5">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <ExportLink kind="reviews" query={scope} />
          </>
        }
      >
        {data && (
          <>
            <ol className="divide-y divide-line">
              {data.reviews.map((r) => <ReviewItem key={r.id} r={r} />)}
            </ol>
            {pages > 1 && (
              <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
                <button type="button" disabled={offset === 0} onClick={() => f.set("offset", String(Math.max(0, offset - PAGE)))}
                  className="rounded border border-line px-3 py-1 disabled:opacity-40">← Previous</button>
                <span className="text-ink-muted">Page {num(pageNo)} of {num(pages)}</span>
                <button type="button" disabled={pageNo >= pages} onClick={() => f.set("offset", String(offset + PAGE))}
                  className="rounded border border-line px-3 py-1 disabled:opacity-40">Next →</button>
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-ink-muted">no rating</span>;
  return (
    <span aria-label={`${rating} out of 5 stars`} title={`${rating} / 5`}>
      <span aria-hidden="true" className="text-[#c98500]">{"★".repeat(Math.round(rating))}</span>
      <span aria-hidden="true" className="text-line">{"★".repeat(5 - Math.round(rating))}</span>
    </span>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const [feedback, setFeedback] = useState<null | "tag" | "pii">(null);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <Stars rating={r.rating} />
        <span>{day(r.date)}</span>
        <span>{r.retailer ?? "–"}</span>
        {r.verified === 1 && <span className="text-positive">✓ verified purchase</span>}
        {(r.helpful ?? 0) > 0 && <span>{num(r.helpful)} found helpful</span>}
        {r.images > 0 && <span>{r.images} customer image{r.images > 1 ? "s" : ""} (not shown)</span>}
        {r.redactions > 0 && <span title="Personal data replaced by tokens">{r.redactions} redaction{r.redactions > 1 ? "s" : ""}</span>}
        <span className="ml-auto">#{r.id}</span>
      </div>
      <div className="mt-0.5 text-xs">
        {r.productId ? (
          <Link href={`/insights/product/${r.productId}`} className="text-brand hover:underline">{r.product}</Link>
        ) : (
          <span>{r.listingName}</span>
        )}
        {r.brand && <span className="text-ink-muted"> · {r.brand}</span>}
      </div>
      {r.title && <p className="mt-1 font-medium">{r.title}</p>}
      {r.text ? <p className="mt-0.5 whitespace-pre-line text-sm">{r.text}</p> : <p className="mt-0.5 text-sm italic text-ink-muted">No review text.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {r.sentiment && (
          <span className={`rounded-full border px-2 py-0.5 ${SENTIMENT_STYLE[r.sentiment] ?? ""}`}
            title={`Score ${r.sentimentScore?.toFixed(2) ?? "–"} (−1 to 1), confidence ${r.confidence?.toFixed(2) ?? "–"}`}>
            {r.sentiment}
          </span>
        )}
        {r.verifiedAt && (
          <span className="rounded-full border border-positive px-2 py-0.5 text-positive" title="A person checked this label on the Data tab; it replaces the automatic one.">
            {r.unclear ? "verified unreadable" : "verified by a person"}
          </span>
        )}
        {r.aiSentiment && r.aiSentiment !== r.sentiment && (
          <span className="rounded-full border border-ai px-2 py-0.5 text-ai" title="Second opinion from AI tagging. The rule-based sentiment is still used in the charts.">
            AI reads it as {r.aiSentiment}
          </span>
        )}
        {r.ratingTextConflict === 1 && <span className="rounded-full border border-[#c98500] px-2 py-0.5">rating disagrees with text</span>}
        {r.themes.map((t) => (
          <span key={t.theme} className="rounded-full bg-canvas px-2 py-0.5"
            title={`${t.vector} · ${t.sentiment ?? "no sentiment"} · confidence ${t.confidence?.toFixed(2) ?? "–"} · tagged by ${t.source}`}>
            {t.label}
            {t.sentiment === "negative" && <span className="text-negative"> −</span>}
            {t.sentiment === "positive" && <span className="text-[#1c5cab]"> +</span>}
          </span>
        ))}
        {(r.sentiment || r.themes.length > 0) && <ProvenanceBadge kind={r.tagSource === "AI" ? "AI" : "DERIVED"} />}
        {r.themes.some((t) => t.source === "AI") && <ProvenanceBadge kind="AI" />}
        <span className="ml-auto flex gap-3">
          <button type="button" onClick={() => setFeedback(feedback === "tag" ? null : "tag")} className="text-brand underline">Is a tag wrong?</button>
          <button type="button" onClick={() => setFeedback(feedback === "pii" ? null : "pii")} className="text-brand underline">Missed personal info?</button>
        </span>
      </div>
      {feedback && <ReviewFeedback kind={feedback} review={r} onClose={() => setFeedback(null)} />}
    </li>
  );
}
