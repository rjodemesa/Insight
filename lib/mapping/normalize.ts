/**
 * Product-name normalization for mapping retailer listings to canonical products.
 * "SudsMax Liquid Detergent 2.4 L" and "SUDSMAX liquid detergent 2400ml" both become
 * name "sudsmax liquid detergent" + size "2400ml". Size and pack count are kept apart
 * from the name: two listings never merge when their sizes differ.
 */
export interface ParsedName {
  /** Name tokens without size, pack count or noise words. */
  tokens: string[];
  normalized: string;
  /** e.g. "2400ml", "1000g", "900ml+x3", or null when no size is given. */
  size: string | null;
}

const UNIT: Record<string, [string, number]> = {
  ml: ["ml", 1], milliliter: ["ml", 1], milliliters: ["ml", 1], millilitre: ["ml", 1], millilitres: ["ml", 1],
  l: ["ml", 1000], ltr: ["ml", 1000], liter: ["ml", 1000], liters: ["ml", 1000], litre: ["ml", 1000], litres: ["ml", 1000],
  g: ["g", 1], gm: ["g", 1], gms: ["g", 1], gram: ["g", 1], grams: ["g", 1],
  kg: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], kilogram: ["g", 1000], kilograms: ["g", 1000],
  oz: ["oz", 1],
};
const SIZE = /(\d+(?:[.,]\d+)?)\s*(milliliters?|millilitres?|ml|liters?|litres?|ltr|l|grams?|gms?|gm|g|kilograms?|kilos?|kg|oz)\b/g;
const PACK = /\b(?:(\d+)\s*(?:x|pcs|pc|pieces|packs?|sachets?|bottles?|pouches?)|(?:x|pack of|set of|bundle of|bundle)\s*(\d+))\b/g;

/** Marketing and listing noise that does not identify a product. */
const NOISE = new Set([
  "new", "original", "authentic", "official", "sale", "promo", "best", "seller", "bestseller", "hot", "free",
  "shipping", "ph", "store", "genuine", "100", "legit", "the", "and", "with", "for", "of", "a", "an",
]);

export function brandKey(brand: string | null | undefined): string {
  return (brand ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function parseProductName(name: string): ParsedName {
  let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ");
  s = s.replace(/[[\](){}]/g, " ");
  const sizes: string[] = [];
  s = s.replace(SIZE, (_m, num: string, unit: string) => {
    const [base, factor] = UNIT[unit] ?? ["", 1];
    const v = Math.round(Number(num.replace(",", ".")) * factor * 100) / 100;
    sizes.push(`${v}${base}`);
    return " ";
  });
  const packs: string[] = [];
  s = s.replace(PACK, (_m, a?: string, b?: string) => {
    const n = Number(a ?? b);
    if (n > 1) packs.push(`x${n}`);
    return " ";
  });
  const tokens = s
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NOISE.has(t));
  const sizeParts = [...new Set(sizes)].sort().concat([...new Set(packs)].sort());
  return { tokens, normalized: tokens.join(" "), size: sizeParts.length ? sizeParts.join("+") : null };
}

function within1Edit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Dice similarity on name tokens (0–1). Tokens of 5+ characters match with one typo
 * ("detergant" = "detergent").
 */
export function nameSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const used = new Set<number>();
  let common = 0;
  for (const x of a) {
    const k = b.findIndex((y, idx) => !used.has(idx) && (x === y || (x.length >= 5 && y.length >= 5 && within1Edit(x, y))));
    if (k >= 0) { used.add(k); common++; }
  }
  return (2 * common) / (a.length + b.length);
}

/** Format words: listings that differ in one of these are different products. */
const FORM = new Set(["refill", "pouch", "sachet", "bottle", "powder", "liquid", "bar", "gel", "spray", "pods", "capsules", "tub", "jug"]);

export function formConflict(a: string[], b: string[]): boolean {
  const fa = a.filter((t) => FORM.has(t)).sort().join(" ");
  const fb = b.filter((t) => FORM.has(t)).sort().join(" ");
  return fa !== fb;
}
