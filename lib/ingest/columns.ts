/** The 32 columns every upload must contain (any order; extra columns are ignored). */
export const REQUIRED_COLUMNS = [
  "retailerName", "market", "site", "productName", "category", "subcategory", "brand",
  "retailerProductCode", "upc", "manufacturer", "productUrl", "additionalProductDescription",
  "ingredients", "productImageUrl", "dateFirstAvailable", "dateAddedToCatalog", "numberOfReviews",
  "productRating", "aboutThisItem", "internalReviewId", "retailerReviewId", "reviewDate",
  "reviewDateISO", "reviewRating", "reviewTitle", "reviewText", "parentOrChild", "reviewUrl",
  "reviewType", "verifiedPurchase", "helpfulReviewCount", "reviewCustomerImages",
] as const;

export type Column = (typeof REQUIRED_COLUMNS)[number];
export type ColumnIndex = Record<Column, number>;

const norm = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase();

/** Matches header cells to required columns, ignoring case, surrounding spaces and a BOM. */
export function validateHeader(header: string[]): { index: ColumnIndex | null; missing: Column[] } {
  const positions = new Map<string, number>();
  header.forEach((h, i) => {
    const k = norm(h ?? "");
    if (k && !positions.has(k)) positions.set(k, i);
  });
  const missing: Column[] = [];
  const index = {} as ColumnIndex;
  for (const col of REQUIRED_COLUMNS) {
    const i = positions.get(col.toLowerCase());
    if (i === undefined) missing.push(col);
    else index[col] = i;
  }
  return { index: missing.length ? null : index, missing };
}
