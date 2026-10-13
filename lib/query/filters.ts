import { taxonomy, VECTORS } from "@/lib/nlp/taxonomy";

/**
 * Shared filters for review, aggregate and product queries. Parsed from the query string
 * against allow-lists; values only ever reach SQL as bound parameters.
 *
 * Multi-value filters repeat the parameter: ?retailer=Lazada&retailer=ShopMart
 */
export interface Filters {
  retailer: string[];
  category: string[];
  subcategory: string[];
  brand: string[];
  product: number[];
  sentiment: string[]; // positive | neutral | negative | none
  language: string[];
  theme: string[];
  vector: string[];
  /** Only reviews whose theme in `theme`/`vector` has this sentiment. */
  themeSentiment: string | null;
  from: string | null; // YYYY-MM-DD, inclusive
  to: string | null; // YYYY-MM-DD, inclusive
  minRating: number | null;
  maxRating: number | null;
  verified: boolean | null;
  conflict: boolean | null;
  includeDuplicates: boolean;
  q: string | null;
}

export class FilterError extends Error {}

const SENTIMENTS = ["positive", "neutral", "negative", "none"];
const LANGUAGES = ["english", "filipino", "taglish", "emoji_only", "empty", "other"];
const MAX_VALUES = 50;
const MAX_LEN = 200;

function strings(sp: URLSearchParams, key: string, allowed?: readonly string[]): string[] {
  const vals = sp.getAll(key).map((v) => v.trim()).filter(Boolean);
  if (vals.length > MAX_VALUES) throw new FilterError(`Too many values for "${key}" (max ${MAX_VALUES}).`);
  for (const v of vals) {
    if (v.length > MAX_LEN) throw new FilterError(`A value for "${key}" is too long.`);
    if (allowed && !allowed.includes(v)) throw new FilterError(`Unknown ${key} "${v.slice(0, 40)}".`);
  }
  return [...new Set(vals)];
}

function date(sp: URLSearchParams, key: string): string | null {
  const v = sp.get(key)?.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new FilterError(`"${key}" must be a date like 2024-01-31.`);
  }
  return v;
}

function rating(sp: URLSearchParams, key: string): number | null {
  const v = sp.get(key);
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 5) throw new FilterError(`"${key}" must be between 1 and 5.`);
  return n;
}

function bool(sp: URLSearchParams, key: string): boolean | null {
  const v = sp.get(key);
  if (v === null || v === "") return null;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new FilterError(`"${key}" must be true or false.`);
}

export function parseFilters(sp: URLSearchParams): Filters {
  const product = strings(sp, "product").map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new FilterError("product must be a product id.");
    return n;
  });
  const themeSentiment = sp.get("themeSentiment") || null;
  if (themeSentiment && !["positive", "neutral", "negative"].includes(themeSentiment)) {
    throw new FilterError("themeSentiment must be positive, neutral or negative.");
  }
  const f: Filters = {
    retailer: strings(sp, "retailer"),
    category: strings(sp, "category"),
    subcategory: strings(sp, "subcategory"),
    brand: strings(sp, "brand"),
    product,
    sentiment: strings(sp, "sentiment", SENTIMENTS),
    language: strings(sp, "language", LANGUAGES),
    theme: strings(sp, "theme", taxonomy().themes.map((t) => t.id)),
    vector: strings(sp, "vector", VECTORS),
    themeSentiment,
    from: date(sp, "from"),
    to: date(sp, "to"),
    minRating: rating(sp, "minRating"),
    maxRating: rating(sp, "maxRating"),
    verified: bool(sp, "verified"),
    conflict: bool(sp, "conflict"),
    includeDuplicates: bool(sp, "includeDuplicates") ?? false,
    q: sp.get("q")?.trim().slice(0, 100) || null,
  };
  if (f.from && f.to && f.from > f.to) throw new FilterError('"from" is after "to".');
  return f;
}

export interface Where {
  sql: string;
  params: (string | number)[];
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** WHERE clause over reviews aliased as `r`. Always returns a clause (at least "1=1"). */
export function whereClause(f: Filters, opts: { skipDates?: boolean } = {}): Where {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  const inList = (col: string, vals: (string | number)[]) => {
    if (!vals.length) return;
    parts.push(`${col} IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  };
  if (!f.includeDuplicates) parts.push("r.is_duplicate = 0");
  inList("r.retailer_name", f.retailer);
  inList("r.category", f.category);
  inList("r.subcategory", f.subcategory);
  inList("r.brand", f.brand);
  inList("r.product_id", f.product);
  inList("r.language", f.language);
  if (f.sentiment.length) {
    const named = f.sentiment.filter((s) => s !== "none");
    const ors: string[] = [];
    if (named.length) {
      ors.push(`r.sentiment IN (${named.map(() => "?").join(",")})`);
      params.push(...named);
    }
    if (f.sentiment.includes("none")) ors.push("r.sentiment IS NULL");
    parts.push(`(${ors.join(" OR ")})`);
  }
  if (f.theme.length || f.vector.length || f.themeSentiment) {
    const sub: string[] = ["t.review_id = r.id"];
    if (f.theme.length) {
      sub.push(`t.theme IN (${f.theme.map(() => "?").join(",")})`);
      params.push(...f.theme);
    }
    if (f.vector.length) {
      sub.push(`t.vector IN (${f.vector.map(() => "?").join(",")})`);
      params.push(...f.vector);
    }
    if (f.themeSentiment) {
      sub.push("t.sentiment = ?");
      params.push(f.themeSentiment);
    }
    parts.push(`EXISTS (SELECT 1 FROM review_themes t WHERE ${sub.join(" AND ")})`);
  }
  if (!opts.skipDates) {
    if (f.from) {
      parts.push("r.review_date_iso >= ?");
      params.push(f.from);
    }
    if (f.to) {
      parts.push("r.review_date_iso < ?");
      params.push(nextDay(f.to));
    }
  }
  if (f.minRating !== null) {
    parts.push("r.review_rating >= ?");
    params.push(f.minRating);
  }
  if (f.maxRating !== null) {
    parts.push("r.review_rating <= ?");
    params.push(f.maxRating);
  }
  if (f.verified !== null) parts.push(f.verified ? "r.verified_purchase = 1" : "(r.verified_purchase IS NULL OR r.verified_purchase = 0)");
  if (f.conflict !== null) parts.push(f.conflict ? "r.rating_text_conflict = 1" : "COALESCE(r.rating_text_conflict, 0) = 0");
  if (f.q) {
    parts.push("(r.review_text LIKE ? ESCAPE '\\' OR r.review_title LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(f.q)}%`;
    params.push(like, like);
  }
  return { sql: parts.length ? parts.join(" AND ") : "1=1", params };
}

/** Echo of the active filters for responses, without empty values. */
export function describeFilters(f: Filters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(f).filter(([k, v]) => (Array.isArray(v) ? v.length > 0 : v !== null && !(k === "includeDuplicates" && v === false))),
  );
}
