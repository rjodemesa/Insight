import type { ColumnIndex, Column } from "./columns";

/** A cleaned source row. Text fields here are still UNREDACTED; never store them as-is. */
export interface CleanRow {
  retailerName: string | null; market: string | null; site: string | null;
  productName: string | null; category: string | null; subcategory: string | null; brand: string | null;
  retailerProductCode: string | null; upc: string | null; manufacturer: string | null;
  productUrl: string | null; productRating: number | null; numberOfReviews: number | null;
  internalReviewId: string | null; retailerReviewId: string | null;
  reviewDateISO: string | null; reviewRating: number | null;
  reviewTitle: string | null; reviewText: string | null;
  parentOrChild: string | null; reviewUrl: string | null; reviewType: string | null;
  verifiedPurchase: number | null; helpfulReviewCount: number | null;
  reviewCustomerImages: string | null;
}

export interface RowIssues {
  invalidDate: boolean;
  invalidRating: boolean;
  missingRating: boolean;
}

const text = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || /^(null|nan|none|undefined)$/i.test(t) ? null : t;
};

const num = (v: string | undefined): number | null => {
  const t = text(v);
  if (t === null) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function bool(v: string | undefined): number | null {
  const t = text(v)?.toLowerCase();
  if (t === undefined || t === null) return null;
  if (["true", "1", "yes", "y"].includes(t)) return 1;
  if (["false", "0", "no", "n"].includes(t)) return 0;
  return null;
}

/** Accepts ISO strings, YYYY-MM-DD, Excel serial numbers. Returns ISO date (UTC) or null. */
export function parseDate(v: string | null): string | null {
  if (!v) return null;
  let d: Date;
  if (/^\d{5}(\.\d+)?$/.test(v)) d = new Date(Math.round((Number(v) - 25569) * 86400 * 1000)); // Excel serial
  else d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  const t = d.getTime();
  // Reject impossible dates: before 2000 or more than a day in the future.
  if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > Date.now() + 86_400_000) return null;
  return d.toISOString();
}

export function cleanRow(cells: string[], idx: ColumnIndex): { row: CleanRow; issues: RowIssues } {
  const get = (c: Column) => cells[idx[c]];
  const rawRating = text(get("reviewRating"));
  let reviewRating = num(get("reviewRating"));
  const invalidRating = rawRating !== null && (reviewRating === null || reviewRating < 1 || reviewRating > 5);
  if (invalidRating) reviewRating = null;

  const rawDate = text(get("reviewDateISO")) ?? text(get("reviewDate"));
  const reviewDateISO = parseDate(rawDate);
  const helpful = num(get("helpfulReviewCount"));

  const row: CleanRow = {
    retailerName: text(get("retailerName")), market: text(get("market")), site: text(get("site")),
    productName: text(get("productName")), category: text(get("category")), subcategory: text(get("subcategory")),
    brand: text(get("brand")), retailerProductCode: text(get("retailerProductCode")), upc: text(get("upc")),
    manufacturer: text(get("manufacturer")), productUrl: text(get("productUrl")),
    productRating: num(get("productRating")), numberOfReviews: num(get("numberOfReviews")),
    internalReviewId: text(get("internalReviewId")), retailerReviewId: text(get("retailerReviewId")),
    reviewDateISO, reviewRating,
    reviewTitle: text(get("reviewTitle")), reviewText: text(get("reviewText")),
    parentOrChild: text(get("parentOrChild")), reviewUrl: text(get("reviewUrl")), reviewType: text(get("reviewType")),
    verifiedPurchase: bool(get("verifiedPurchase")),
    helpfulReviewCount: helpful === null ? null : Math.max(0, Math.round(helpful)),
    reviewCustomerImages: text(get("reviewCustomerImages")),
  };
  return {
    row,
    issues: { invalidDate: rawDate !== null && reviewDateISO === null, invalidRating, missingRating: rawRating === null },
  };
}
