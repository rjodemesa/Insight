/**
 * Re-tags stored reviews with the current taxonomy and lexicons, and maps reviews that
 * have no product yet. Run after editing config/*.json, or once to tag Phase 1 imports.
 *   npm run reprocess            only reviews tagged with an older version
 *   npm run reprocess -- --all   every review
 * Stop `npm run dev` first. Works on redacted text only; the vault key is not needed.
 */
import { openDb } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { reprocess } from "@/lib/nlp/reprocess";

async function main() {
  const all = process.argv.includes("--all");
  const conn = openDb();
  const started = Date.now();
  try {
    const stats = await reprocess(conn, {
      all,
      onProgress: (d, t) => process.stdout.write(`\r${d.toLocaleString()} / ${t.toLocaleString()} reviews`),
    });
    const ms = Date.now() - started;
    appendAudit(conn, { role: "system", action: "nlp_reprocess", entityType: "reviews", details: { ...stats, all, durationMs: ms, via: "cli" } });
    console.log(
      `\nTagged ${stats.reviews.toLocaleString()} reviews with ${stats.version} in ${(ms / 1000).toFixed(1)} s. ` +
        `Products: ${stats.mapping.listings} listings mapped, ${stats.mapping.newProducts} new.`,
    );
  } finally {
    conn.close();
  }
}

main().catch((err) => {
  console.error(`\n[reprocess] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
