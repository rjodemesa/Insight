/** Query-string keys that parseFilters reads. Anything else in a URL is ignored. Safe to import in the browser. */
export const FILTER_KEYS = [
  "retailer", "category", "subcategory", "brand", "product", "sentiment", "language", "theme", "vector",
  "themeSentiment", "from", "to", "minRating", "maxRating", "verified", "conflict", "includeDuplicates", "q", "review", "hasText", "hasPhotos",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** Keys that take several values (?brand=A&brand=B). */
export const MULTI_KEYS: readonly FilterKey[] = ["retailer", "category", "subcategory", "brand", "product", "sentiment", "language", "theme", "vector", "review"];
