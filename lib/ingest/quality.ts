import type { CleanRow, RowIssues } from "./clean";
import type { MappingStats } from "@/lib/mapping/products";
import type { ReviewAnalysis } from "@/lib/nlp/analyze";
import type { Language } from "@/lib/nlp/language";
import type { PiiKind } from "@/lib/redact/rules";

export interface QualityReport {
  totalRows: number;
  emptyText: number;
  tinyText: number; // 1–3 characters, e.g. "ty"
  duplicates: number; // by retailerReviewId, within the file or already in the database
  invalidDates: number;
  missingDates: number;
  invalidRatings: number;
  missingRatings: number;
  missingVerified: number;
  languages: Partial<Record<Language, number>>;
  redactions: Partial<Record<PiiKind, number>>;
  recordsWithRedactions: number;
  categories: Record<string, number>;
  retailers: Record<string, number>;
  dateRange: { from: string | null; to: string | null };
  /** 0–100. See QUALITY_SCORE_FORMULA. */
  score: number;
  /** Phase 2 tagging summary. Absent on reports from earlier imports. */
  nlp?: NlpSummary;
}

export interface NlpSummary {
  sentiment: { positive: number; neutral: number; negative: number; none: number };
  recordsWithThemes: number;
  ratingTextConflicts: number;
  /** Theme id → number of reviews tagged with it. */
  themes: Record<string, number>;
  /** Vector → number of reviews with at least one theme in it. */
  vectors: Record<string, number>;
  mapping: MappingStats | null;
}

/**
 * Data-quality score (DERIVED), 0–100:
 *   100 × (1 − 0.35·emptyTextShare − 0.20·duplicateShare − 0.20·invalidOrMissingDateShare
 *            − 0.15·invalidOrMissingRatingShare − 0.10·missingVerifiedShare)
 * Weights reflect how much each problem limits insight: empty text removes the review
 * from theme analysis entirely, duplicates inflate counts, dates drive trends.
 */
export const QUALITY_SCORE_FORMULA =
  "100 × (1 − 0.35·empty text − 0.20·duplicates − 0.20·bad/missing dates − 0.15·bad/missing ratings − 0.10·missing verified flag)";

export class QualityAccumulator {
  private r: QualityReport = {
    totalRows: 0, emptyText: 0, tinyText: 0, duplicates: 0, invalidDates: 0, missingDates: 0,
    invalidRatings: 0, missingRatings: 0, missingVerified: 0, languages: {}, redactions: {},
    recordsWithRedactions: 0, categories: {}, retailers: {}, dateRange: { from: null, to: null }, score: 0,
  };
  private nlp: NlpSummary = {
    sentiment: { positive: 0, neutral: 0, negative: 0, none: 0 },
    recordsWithThemes: 0, ratingTextConflicts: 0, themes: {}, vectors: {}, mapping: null,
  };

  setMapping(m: MappingStats) {
    this.nlp.mapping = m;
  }

  add(row: CleanRow, issues: RowIssues, extra: { duplicate: boolean; language: Language; redactions: PiiKind[]; analysis?: ReviewAnalysis }) {
    const r = this.r;
    r.totalRows++;
    const len = row.reviewText?.length ?? 0;
    if (len === 0) r.emptyText++;
    else if (len <= 3) r.tinyText++;
    if (extra.duplicate) r.duplicates++;
    if (issues.invalidDate) r.invalidDates++;
    else if (!row.reviewDateISO) r.missingDates++;
    if (issues.invalidRating) r.invalidRatings++;
    if (issues.missingRating) r.missingRatings++;
    if (row.verifiedPurchase === null) r.missingVerified++;
    r.languages[extra.language] = (r.languages[extra.language] ?? 0) + 1;
    if (extra.redactions.length) r.recordsWithRedactions++;
    for (const k of extra.redactions) r.redactions[k] = (r.redactions[k] ?? 0) + 1;
    const cat = row.category ?? "(none)";
    r.categories[cat] = (r.categories[cat] ?? 0) + 1;
    const ret = row.retailerName ?? "(none)";
    r.retailers[ret] = (r.retailers[ret] ?? 0) + 1;
    const a = extra.analysis;
    if (a) {
      const n = this.nlp;
      n.sentiment[a.sentiment ?? "none"]++;
      if (a.ratingTextConflict === 1) n.ratingTextConflicts++;
      if (a.themes.length) n.recordsWithThemes++;
      for (const t of a.themes) n.themes[t.theme] = (n.themes[t.theme] ?? 0) + 1;
      for (const v of new Set(a.themes.map((t) => t.vector))) n.vectors[v] = (n.vectors[v] ?? 0) + 1;
    }
    const d = row.reviewDateISO;
    if (d) {
      if (!r.dateRange.from || d < r.dateRange.from) r.dateRange.from = d;
      if (!r.dateRange.to || d > r.dateRange.to) r.dateRange.to = d;
    }
  }

  report(): QualityReport {
    const r = this.r;
    const n = r.totalRows || 1;
    const penalty =
      0.35 * (r.emptyText / n) +
      0.2 * (r.duplicates / n) +
      0.2 * ((r.invalidDates + r.missingDates) / n) +
      0.15 * ((r.invalidRatings + r.missingRatings) / n) +
      0.1 * (r.missingVerified / n);
    return { ...r, score: r.totalRows ? Math.round(1000 * (1 - penalty)) / 10 : 0, nlp: this.nlp };
  }
}
