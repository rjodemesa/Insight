import type Database from "better-sqlite3";
import { parseProductName } from "./normalize";

/**
 * Analyst corrections to product mapping. Both edits move aliases as well as reviews, so
 * later imports and `npm run reprocess` (which only maps unmapped reviews) keep them.
 * Callers audit-log the result and clear the aggregate cache.
 */
type Conn = Database.Database;

export class MappingEditError extends Error {}

/** Products to check first: lowest alias similarity (fuzzy matches), then most aliases. */
export function mappingReview(conn: Conn, opts: { q: string | null; limit: number; offset: number }) {
  const where = opts.q ? "WHERE p.canonical_name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\'" : "";
  const like = opts.q ? `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const args = like ? [like, like] : [];
  const total = conn.prepare(`SELECT COUNT(*) FROM products p ${where}`).pluck().get(...args) as number;
  const rows = conn
    .prepare(
      `SELECT p.id, p.canonical_name AS name, p.brand, p.category, p.subcategory, p.size_token AS size,
         COUNT(a.id) AS aliases, MIN(COALESCE(a.similarity, 1)) AS lowestSimilarity,
         (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.is_duplicate = 0) AS reviews
       FROM products p LEFT JOIN product_aliases a ON a.product_id = p.id ${where}
       GROUP BY p.id ORDER BY lowestSimilarity ASC, aliases DESC, reviews DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, opts.limit, opts.offset);
  return {
    total, limit: opts.limit, offset: opts.offset, products: rows,
    method: "Lowest similarity is the weakest fuzzy match among a product's alternate names (1 = exact). Low values and many alternate names are the likeliest wrong merges.",
  };
}

export function aliasesOf(conn: Conn, productId: number) {
  return conn
    .prepare(
      "SELECT id, normalized_name AS name, retailer_product_code AS code, upc, similarity FROM product_aliases WHERE product_id = ? ORDER BY similarity ASC, id",
    )
    .all(productId) as { id: number; name: string; code: string | null; upc: string | null; similarity: number | null }[];
}

const exists = (conn: Conn, id: number) => conn.prepare("SELECT 1 FROM products WHERE id = ?").get(id) !== undefined;

/** Moves every alias and review of `sourceIds` onto `targetId`, then deletes the sources. */
export function mergeProducts(conn: Conn, targetId: number, sourceIds: number[]) {
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (!sources.length) throw new MappingEditError("Pick at least one other product to merge in.");
  if (sources.length > 50) throw new MappingEditError("Merge at most 50 products at a time.");
  return conn.transaction(() => {
    for (const id of [targetId, ...sources]) if (!exists(conn, id)) throw new MappingEditError(`Product ${id} not found.`);
    const list = sources.map(() => "?").join(",");
    const aliases = conn.prepare(`UPDATE product_aliases SET product_id = ? WHERE product_id IN (${list})`).run(targetId, ...sources).changes;
    const reviews = conn.prepare(`UPDATE reviews SET product_id = ? WHERE product_id IN (${list})`).run(targetId, ...sources).changes;
    conn.prepare(`DELETE FROM products WHERE id IN (${list})`).run(...sources);
    // Confidence 1 marks a product an analyst has confirmed.
    conn.prepare("UPDATE products SET confidence = 1 WHERE id = ?").run(targetId);
    return { targetId, merged: sources, aliasesMoved: aliases, reviewsMoved: reviews };
  })();
}

const aliasKey = (normalized: string, code: string | null, upc: string | null) =>
  `${normalized}\u0000${code?.trim() || ""}\u0000${upc?.trim() || ""}`;

/**
 * Moves the chosen aliases, and the reviews whose listing matches them, to a new product.
 * At least one alias must stay behind.
 */
export function splitProduct(conn: Conn, productId: number, aliasIds: number[], newName?: string | null) {
  const ids = [...new Set(aliasIds)];
  return conn.transaction(() => {
    const product = conn.prepare("SELECT id, canonical_name, brand, category, subcategory FROM products WHERE id = ?").get(productId) as
      | { id: number; canonical_name: string; brand: string | null; category: string | null; subcategory: string | null }
      | undefined;
    if (!product) throw new MappingEditError("Product not found.");
    const all = aliasesOf(conn, productId);
    const moving = all.filter((a) => ids.includes(a.id));
    if (!moving.length || moving.length !== ids.length) throw new MappingEditError("Pick alternate names that belong to this product.");
    if (moving.length === all.length) throw new MappingEditError("Leave at least one alternate name on the original product.");

    const keys = new Set(moving.map((a) => aliasKey(a.name, a.code, a.upc)));
    const listings = conn
      .prepare("SELECT DISTINCT product_name, retailer_product_code, upc FROM reviews WHERE product_id = ? AND product_name IS NOT NULL")
      .all(productId) as { product_name: string; retailer_product_code: string | null; upc: string | null }[];
    const matched = listings.filter((l) => keys.has(aliasKey(parseProductName(l.product_name).normalized, l.retailer_product_code, l.upc)));
    const first = matched[0]?.product_name ?? moving[0]!.name;
    const name = newName?.trim().slice(0, 200) || first.replace(/\s+/g, " ").trim();

    const newId = Number(
      conn
        .prepare("INSERT INTO products (canonical_name, brand, category, subcategory, size_token, confidence) VALUES (?, ?, ?, ?, ?, 1)")
        .run(name, product.brand, product.category, product.subcategory, parseProductName(first).size).lastInsertRowid,
    );
    const moveAlias = conn.prepare("UPDATE product_aliases SET product_id = ? WHERE id = ?");
    for (const a of moving) moveAlias.run(newId, a.id);
    const moveReviews = conn.prepare(
      "UPDATE reviews SET product_id = ? WHERE product_id = ? AND product_name = ? AND COALESCE(retailer_product_code, '') = ? AND COALESCE(upc, '') = ?",
    );
    let reviews = 0;
    for (const l of matched) reviews += moveReviews.run(newId, productId, l.product_name, l.retailer_product_code ?? "", l.upc ?? "").changes;
    conn.prepare("UPDATE products SET confidence = 1 WHERE id = ?").run(productId);
    return { productId, newProductId: newId, newName: name, aliasesMoved: moving.length, reviewsMoved: reviews };
  })();
}
