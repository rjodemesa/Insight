/**
 * Generates fixtures/sample_reviews.xlsx: 200 SYNTHETIC rows (no real data) in the
 * 32-column layout, with deliberate mess: empty and tiny text, Taglish, emoji, fake PII,
 * duplicates, a bad rating and a bad date, plus an ignored PointerStorage sheet.
 * Deterministic: the same file is produced every run.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { REQUIRED_COLUMNS } from "../lib/ingest/columns";

export const FIXTURE_PATH = path.join(process.cwd(), "fixtures", "sample_reviews.xlsx");

// Small deterministic PRNG (mulberry32).
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  ["SudsMax Liquid Detergent 2.4L", "Laundry", "SudsMax"],
  ["SudsMax Liquid Detergent 1L Refill", "Laundry", "SudsMax"],
  ["FreshBreeze Fabric Conditioner 900ml", "Fabric Enhancer", "FreshBreeze"],
  ["FreshBreeze Fabric Conditioner 1.5L", "Fabric Enhancer", "FreshBreeze"],
  ["BrightWhite Bleach 1L", "Bleach", "BrightWhite"],
  ["Generic Powder Detergent 1kg", "Laundry", "No Brand"],
] as const;

export const TEXTS = [
  "Sobrang bango! Sulit talaga 😍",
  "Mabilis dumating, legit seller. Thank you!",
  "Hindi maganda, tumagas yung bote pagdating 😡",
  "Very good quality, smells great",
  "di bango, parang fake",
  "ty",
  "",
  "👍👍👍",
  "Okay naman pero mahal na ngayon",
  "Leak sa packaging, sira yung takip",
  "Ako si Maria Santos, text me at 0917 123 4567 kung may promo",
  "Order no: 123456789012345 still not delivered. Email me juan.dc@example.com",
  "Pls follow @shopper_ph sa IG, Brgy. San Isidro kami",
  "Great product - Ana",
  "Mabango at malinis. Will buy again!",
];

export async function makeFixture(file = FIXTURE_PATH): Promise<{ rows: Record<string, string>[] }> {
  const rand = rng(42);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < 200; i++) {
    const [name, sub, brand] = pick(PRODUCTS);
    const day = new Date(Date.UTC(2023, 0, 1) + Math.floor(rand() * 500) * 86_400_000);
    const text = i < TEXTS.length ? TEXTS[i]! : pick(TEXTS);
    const rating = text.includes("Hindi") || text.includes("Leak") || text.includes("fake") ? "1" : pick(["5", "5", "5", "4", "3"]);
    const r: Record<string, string> = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, ""]));
    Object.assign(r, {
      retailerName: i % 5 === 0 ? "ShopMart" : "Lazada", market: "PH", site: "lazada.com.ph",
      productName: name, category: "Fabric Care", subcategory: sub, brand,
      retailerProductCode: `RP-${name.length}${brand.length}`, productUrl: "https://example.com/p",
      numberOfReviews: "200", productRating: "4.8",
      internalReviewId: `INT-${i + 1}`, retailerReviewId: `RR-${i + 1}`,
      reviewDate: day.toISOString().slice(0, 10), reviewDateISO: day.toISOString(),
      reviewRating: rating, reviewTitle: "", reviewText: text, parentOrChild: "parent",
      reviewUrl: "https://example.com/r", reviewType: "Organic",
      verifiedPurchase: i % 17 === 0 ? "" : "TRUE",
      helpfulReviewCount: i % 23 === 0 ? String(i % 7) : "",
      reviewCustomerImages: i % 9 === 0 ? "https://img.example.com/a.jpg, https://img.example.com/b.jpg" : "",
    });
    rows.push(r);
  }
  // Deliberate problems.
  rows[198]!.retailerReviewId = rows[0]!.retailerReviewId!; // duplicate
  rows[199]!.retailerReviewId = rows[1]!.retailerReviewId!; // duplicate
  rows[150]!.reviewRating = "9"; // invalid rating
  rows[151]!.reviewDateISO = "not a date"; // invalid date
  rows[151]!.reviewDate = "";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([...REQUIRED_COLUMNS]);
  for (const r of rows) ws.addRow(REQUIRED_COLUMNS.map((c) => r[c]));
  wb.addWorksheet("PointerStorage").addRow(["internal", "ignore me"]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return { rows };
}

if (process.argv[1] && /make-fixture/.test(process.argv[1])) {
  makeFixture().then(() => console.log(`Wrote ${FIXTURE_PATH}`));
}
