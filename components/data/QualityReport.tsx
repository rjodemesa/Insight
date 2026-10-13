"use client";

import ProvenanceBadge from "@/components/ProvenanceBadge";
import taxonomy from "@/config/taxonomy.json";
import type { QualityReport as Report } from "@/lib/ingest/quality";

const THEME_LABEL: Record<string, string> = Object.fromEntries(taxonomy.themes.map((t) => [t.id, t.label]));

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "–");

function Tile({ label, value, sub, kind = "OBSERVED" }: { label: string; value: string; sub?: string; kind?: "OBSERVED" | "DERIVED" }) {
  return (
    <div className="rounded border border-line p-3">
      <div className="text-xs text-ink-muted">
        {label}
        <ProvenanceBadge kind={kind} />
      </div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, data, total }: { title: string; data: Record<string, number>; total: number }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1">{k.replace("_", " ")}</td>
              <td className="py-1 text-right tabular-nums">{v.toLocaleString()}</td>
              <td className="w-16 py-1 text-right tabular-nums text-ink-muted">{pct(v, total)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="py-1 text-ink-muted">None found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function QualityReport({ filename, report, formula }: { filename: string; report: Report; formula: string }) {
  const n = report.totalRows;
  return (
    <section aria-labelledby="quality-title" className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <h2 id="quality-title" className="text-lg font-semibold">Data-quality report · {filename}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Quality score" value={`${report.score} / 100`} sub={formula} kind="DERIVED" />
        <Tile label="Rows imported" value={n.toLocaleString()} sub={`${day(report.dateRange.from)} to ${day(report.dateRange.to)}`} />
        <Tile label="Missing review text" value={pct(report.emptyText, n)} sub={`${report.emptyText.toLocaleString()} rows; ${report.tinyText} more of 1–3 characters`} />
        <Tile label="Duplicates (retailerReviewId)" value={report.duplicates.toLocaleString()} sub="Flagged and excluded from analysis" />
        <Tile label="Invalid or missing dates" value={(report.invalidDates + report.missingDates).toLocaleString()} sub={`${report.invalidDates} invalid, ${report.missingDates} missing`} />
        <Tile label="Invalid or missing ratings" value={(report.invalidRatings + report.missingRatings).toLocaleString()} sub={`${report.invalidRatings} outside 1–5, ${report.missingRatings} missing`} />
        <Tile label="Missing verified flag" value={pct(report.missingVerified, n)} />
        <Tile label="Records with redactions" value={report.recordsWithRedactions.toLocaleString()} sub={pct(report.recordsWithRedactions, n)} kind="DERIVED" />
      </div>
      {report.nlp && <Tagging nlp={report.nlp} n={n} />}
      <div className="grid gap-6 md:grid-cols-3">
        <Breakdown title="Language mix" data={report.languages as Record<string, number>} total={n} />
        <Breakdown title="Redactions by type" data={report.redactions as Record<string, number>} total={report.recordsWithRedactions} />
        <div className="space-y-4">
          <Breakdown title="Retailers" data={report.retailers} total={n} />
          <Breakdown title="Categories" data={report.categories} total={n} />
        </div>
      </div>
    </section>
  );
}

function Tagging({ nlp, n }: { nlp: NonNullable<Report["nlp"]>; n: number }) {
  const s = nlp.sentiment;
  const withText = n - s.none;
  const m = nlp.mapping;
  const themes = Object.fromEntries(Object.entries(nlp.themes).map(([k, v]) => [THEME_LABEL[k] ?? k, v]));
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Tagging and product mapping</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Positive / neutral / negative" kind="DERIVED"
          value={`${pct(s.positive, withText)} / ${pct(s.neutral, withText)} / ${pct(s.negative, withText)}`}
          sub={`Of ${withText.toLocaleString()} reviews with text. Rule-based lexicon.`} />
        <Tile label="Reviews with a theme" kind="DERIVED" value={pct(nlp.recordsWithThemes, withText)}
          sub={`${nlp.recordsWithThemes.toLocaleString()} reviews`} />
        <Tile label="Rating and text disagree" kind="DERIVED" value={nlp.ratingTextConflicts.toLocaleString()}
          sub="4–5 stars with clearly negative text, or 1–2 stars with clearly positive text" />
        {m && (
          <Tile label="Products" kind="DERIVED" value={`${m.listings.toLocaleString()} listings`}
            sub={`${m.newProducts} new products, ${m.exactMatches} exact and ${m.fuzzyMatches} fuzzy matches to known ones`} />
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <Breakdown title="Reviews per vector" data={nlp.vectors} total={withText} />
        <div className="md:col-span-2">
          <Breakdown title="Reviews per theme" data={themes} total={withText} />
        </div>
      </div>
    </div>
  );
}
