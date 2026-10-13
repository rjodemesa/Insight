/**
 * Times the dashboard queries against the local database (read-only).
 *   npx tsx scripts/bench-queries.ts
 */
import Database from "better-sqlite3";
import { DB_PATH } from "@/lib/db";
import { brands, listReviews, products, retailers, summary, themes, trend } from "@/lib/insights/queries";
import { parseFilters } from "@/lib/query/filters";

const conn = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const cases: [string, string][] = [["all", ""], ["one brand", "brand=Downy"], ["negative leak", "theme=leak&themeSentiment=negative"]];

for (const [label, qs] of cases) {
  const f = parseFilters(new URLSearchParams(qs));
  const time = (name: string, fn: () => unknown) => {
    const t = performance.now();
    fn();
    console.log(`${label.padEnd(14)} ${name.padEnd(10)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`);
  };
  time("summary", () => summary(conn, f));
  time("trend", () => trend(conn, f, "month"));
  time("themes", () => themes(conn, f));
  time("retailers", () => retailers(conn, f));
  time("brands", () => brands(conn, f));
  time("products", () => products(conn, f));
  time("reviews", () => listReviews(conn, f, { sort: "newest", limit: 25, offset: 0 }));
}
