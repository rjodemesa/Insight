import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { mapProducts } from "@/lib/mapping/products";
import { formConflict, nameSimilarity, parseProductName } from "@/lib/mapping/normalize";

describe("product name normalization", () => {
  it("separates and normalizes sizes", () => {
    expect(parseProductName("SudsMax Liquid Detergent 2.4L")).toMatchObject({ normalized: "sudsmax liquid detergent", size: "2400ml" });
    expect(parseProductName("SUDSMAX liquid detergent 2400 ml")).toMatchObject({ normalized: "sudsmax liquid detergent", size: "2400ml" });
    expect(parseProductName("Powder 1kg x 3").size).toBe("1000g+x3");
    expect(parseProductName("[NEW] Official Brand Soap Bar 90g").normalized).toBe("brand soap bar");
  });

  it("scores similarity with typo tolerance and blocks format conflicts", () => {
    expect(nameSimilarity(["sudsmax", "liquid", "detergant"], ["sudsmax", "liquid", "detergent"])).toBe(1);
    expect(nameSimilarity(["a", "b"], ["c", "d"])).toBe(0);
    expect(formConflict(["detergent", "refill"], ["detergent"])).toBe(true);
    expect(formConflict(["liquid", "detergent"], ["detergent", "liquid"])).toBe(false);
  });
});

describe("mapProducts", () => {
  function setup() {
    const conn = openDb(":memory:");
    const job = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('t', 'running')").run().lastInsertRowid);
    const add = (brand: string, name: string, code: string | null = null, upc: string | null = null, ingest = job) =>
      conn
        .prepare("INSERT INTO reviews (ingest_id, brand, product_name, retailer_product_code, upc, category) VALUES (?, ?, ?, ?, ?, 'Fabric Care')")
        .run(ingest, brand, name, code, upc);
    return { conn, job, add };
  }

  it("merges spelling variants, keeps sizes, formats and brands apart", async () => {
    const { conn, job, add } = setup();
    for (let i = 0; i < 3; i++) add("SudsMax", "SudsMax Liquid Detergent 2.4L");
    add("SudsMax", "SUDSMAX Liquid Detergent 2400ml"); // exact after normalization
    add("SudsMax", "SudsMax Liquid Laundry Detergent 2.4L"); // fuzzy
    add("SudsMax", "SudsMax Liquid Detergent 1L"); // different size
    add("SudsMax", "SudsMax Liquid Detergent 2.4L Refill"); // different format
    add("OtherBrand", "SudsMax Liquid Detergent 2.4L"); // different brand
    conn.prepare("INSERT INTO reviews (ingest_id, brand) VALUES (?, 'X')").run(job); // no product name
    const stats = await mapProducts(conn, job);
    expect(stats).toMatchObject({ newProducts: 4, fuzzyMatches: 1, unmapped: 1 });
    const main = conn.prepare("SELECT product_id FROM reviews WHERE product_name = 'SudsMax Liquid Detergent 2.4L' AND brand = 'SudsMax'").pluck().get();
    const variants = conn
      .prepare("SELECT DISTINCT product_id FROM reviews WHERE product_name IN ('SUDSMAX Liquid Detergent 2400ml', 'SudsMax Liquid Laundry Detergent 2.4L')")
      .pluck().all();
    expect(variants).toEqual([main]);
    expect(conn.prepare("SELECT canonical_name FROM products WHERE id = ?").pluck().get(main)).toBe("SudsMax Liquid Detergent 2.4L");
    const fuzzy = conn.prepare("SELECT similarity FROM product_aliases WHERE normalized_name = 'sudsmax liquid laundry detergent'").pluck().get() as number;
    expect(fuzzy).toBeGreaterThanOrEqual(0.85);
    expect(fuzzy).toBeLessThan(1);
  });

  it("reuses products across imports by UPC and retailer code", async () => {
    const { conn, job, add } = setup();
    add("FreshBreeze", "FreshBreeze Conditioner 900ml", "RP-1", "4800000000001");
    await mapProducts(conn, job);
    const job2 = Number(conn.prepare("INSERT INTO ingest_jobs (filename, status) VALUES ('t2', 'running')").run().lastInsertRowid);
    add("FreshBreeze", "Totally different listing title", null, "4800000000001", job2); // same UPC
    add("FreshBreeze", "Another title 900 ml", "RP-1", null, job2); // same code and size
    add("FreshBreeze", "Another title 1.5L", "RP-1", null, job2); // same code, different size → new
    const stats = await mapProducts(conn, job2);
    expect(stats.newProducts).toBe(1);
    expect(conn.prepare("SELECT COUNT(DISTINCT product_id) FROM reviews").pluck().get()).toBe(2);
  });
});
