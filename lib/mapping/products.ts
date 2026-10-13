import type Database from "better-sqlite3";
import { brandKey, formConflict, nameSimilarity, parseProductName } from "./normalize";

/**
 * Maps each review's listing (brand, product name, retailer code, UPC) to a canonical
 * product. Match order, first hit wins:
 *   1. UPC already known
 *   2. same brand + retailer product code (and no size conflict)
 *   3. same brand + normalized name + size
 *   4. fuzzy: same brand and size, no format conflict, name similarity ≥ FUZZY_THRESHOLD
 *   5. otherwise a new product
 * Each new spelling, code or UPC is stored as an alias with its similarity, so the
 * mapping is explainable and can be corrected later (merge/split, Phase 3).
 */
export const FUZZY_THRESHOLD = 0.85;

export interface MappingStats {
  listings: number;
  newProducts: number;
  exactMatches: number;
  fuzzyMatches: number;
  unmapped: number; // reviews without a product name
}

interface Known {
  productId: number;
  brand: string;
  size: string | null;
  tokens: string[];
}

interface Listing {
  brand: string | null;
  product_name: string | null;
  retailer_product_code: string | null;
  upc: string | null;
  category: string | null;
  subcategory: string | null;
}

const listingKey = (l: { brand: string | null; product_name: string | null; retailer_product_code: string | null; upc: string | null }) =>
  [l.brand, l.product_name, l.retailer_product_code, l.upc].map((v) => v ?? "").join("\u0000");

const tick = () => new Promise<void>((r) => setImmediate(r));

class ProductIndex {
  private byUpc = new Map<string, number>();
  /** One retailer code can cover several sizes, so keep every product seen with it. */
  private byCode = new Map<string, { productId: number; size: string | null }[]>();
  private byName = new Map<string, number>();
  private byBrand = new Map<string, Known[]>();
  private aliasSeen = new Set<string>();

  constructor(private conn: Database.Database) {
    const rows = conn
      .prepare(
        `SELECT a.product_id, a.normalized_name, a.retailer_product_code, a.upc, p.brand, p.size_token
         FROM product_aliases a JOIN products p ON p.id = a.product_id`,
      )
      .all() as { product_id: number; normalized_name: string; retailer_product_code: string | null; upc: string | null; brand: string | null; size_token: string | null }[];
    for (const r of rows) this.remember(r.product_id, brandKey(r.brand), r.size_token, r.normalized_name, r.retailer_product_code, r.upc);
  }

  private remember(productId: number, brand: string, size: string | null, normalized: string, code: string | null, upc: string | null) {
    if (upc) this.byUpc.set(upc, productId);
    if (code) {
      const list = this.byCode.get(`${brand}|${code}`) ?? [];
      if (!list.some((c) => c.productId === productId && c.size === size)) list.push({ productId, size });
      this.byCode.set(`${brand}|${code}`, list);
    }
    const nameKey = `${brand}|${normalized}|${size ?? ""}`;
    if (!this.byName.has(nameKey)) {
      this.byName.set(nameKey, productId);
      const list = this.byBrand.get(brand) ?? [];
      list.push({ productId, brand, size, tokens: normalized.split(" ").filter(Boolean) });
      this.byBrand.set(brand, list);
    }
    this.aliasSeen.add(`${productId}|${normalized}|${code ?? ""}|${upc ?? ""}`);
  }

  resolve(l: Listing, stats: MappingStats): number {
    const brand = brandKey(l.brand);
    const parsed = parseProductName(l.product_name!);
    const upc = l.upc?.trim() || null;
    const code = l.retailer_product_code?.trim() || null;
    let productId: number | undefined;
    let similarity = 1;

    if (upc) productId = this.byUpc.get(upc);
    if (productId === undefined && code) {
      const hits = this.byCode.get(`${brand}|${code}`) ?? [];
      const hit = hits.find((c) => c.size === parsed.size) ?? (hits.length === 1 && (!hits[0]!.size || !parsed.size) ? hits[0] : undefined);
      if (hit) productId = hit.productId;
    }
    productId ??= this.byName.get(`${brand}|${parsed.normalized}|${parsed.size ?? ""}`);
    if (productId !== undefined) stats.exactMatches++;
    else {
      let best: { id: number; sim: number } | null = null;
      for (const k of this.byBrand.get(brand) ?? []) {
        if (k.size !== parsed.size || formConflict(k.tokens, parsed.tokens)) continue;
        const sim = nameSimilarity(k.tokens, parsed.tokens);
        if (sim >= FUZZY_THRESHOLD && (!best || sim > best.sim)) best = { id: k.productId, sim };
      }
      if (best) {
        productId = best.id;
        similarity = Math.round(best.sim * 1000) / 1000;
        stats.fuzzyMatches++;
      }
    }
    if (productId === undefined) {
      productId = Number(
        this.conn
          .prepare("INSERT INTO products (canonical_name, brand, category, subcategory, size_token, confidence) VALUES (?, ?, ?, ?, ?, 1)")
          .run(l.product_name!.replace(/\s+/g, " ").trim(), l.brand, l.category, l.subcategory, parsed.size).lastInsertRowid,
      );
      stats.newProducts++;
    }
    if (!this.aliasSeen.has(`${productId}|${parsed.normalized}|${code ?? ""}|${upc ?? ""}`)) {
      this.conn
        .prepare("INSERT INTO product_aliases (product_id, normalized_name, retailer_product_code, upc, similarity) VALUES (?, ?, ?, ?, ?)")
        .run(productId, parsed.normalized, code, upc, similarity);
    }
    this.remember(productId, brand, parsed.size, parsed.normalized, code, upc);
    return productId;
  }
}

/**
 * Maps every review of one import (or, with ingestId null, every unmapped review).
 * Yields to the event loop between batches so the server stays responsive.
 */
export async function mapProducts(
  conn: Database.Database,
  ingestId: number | null,
  opts: { checkCancel?: () => void } = {},
): Promise<MappingStats> {
  const scope = ingestId === null ? "product_id IS NULL" : "ingest_id = ?";
  const args = ingestId === null ? [] : [ingestId];
  const stats: MappingStats = { listings: 0, newProducts: 0, exactMatches: 0, fuzzyMatches: 0, unmapped: 0 };

  // Most-reviewed listing first, so its spelling becomes the canonical name.
  const listings = conn
    .prepare(
      `SELECT brand, product_name, retailer_product_code, upc, MIN(category) AS category, MIN(subcategory) AS subcategory
       FROM reviews WHERE ${scope} AND product_name IS NOT NULL
       GROUP BY brand, product_name, retailer_product_code, upc ORDER BY COUNT(*) DESC`,
    )
    .all(...args) as Listing[];
  const index = new ProductIndex(conn);
  const idFor = new Map<string, number>();
  conn.transaction(() => {
    for (const l of listings) idFor.set(listingKey(l), index.resolve(l, stats));
  })();
  stats.listings = listings.length;

  const page = conn.prepare(
    `SELECT id, brand, product_name, retailer_product_code, upc FROM reviews WHERE ${scope} AND id > ? ORDER BY id LIMIT 2000`,
  );
  const update = conn.prepare("UPDATE reviews SET product_id = ? WHERE id = ?");
  const apply = conn.transaction((rows: (Listing & { id: number })[]) => {
    for (const r of rows) {
      const pid = r.product_name ? idFor.get(listingKey(r)) : undefined;
      if (pid === undefined) stats.unmapped++;
      else update.run(pid, r.id);
    }
  });
  // With ingestId null the scope shrinks as rows are mapped, so page by id either way.
  for (let after = 0; ; ) {
    const rows = page.all(...args, after) as (Listing & { id: number })[];
    if (rows.length === 0) break;
    apply(rows);
    after = rows[rows.length - 1]!.id;
    opts.checkCancel?.();
    await tick();
  }
  return stats;
}
