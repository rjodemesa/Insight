/**
 * AI second-opinion tagging for reviews the rules handle badly.
 *   npm run ai-tag                          200 reviews, untagged and rating/text conflicts
 *   npm run ai-tag -- --limit 1000          more reviews per run (each 20 is one Gemini call)
 *   npm run ai-tag -- --scope untagged      only reviews with text but no theme (or: conflict)
 *   npm run ai-tag -- --count               show how many reviews are waiting, call nothing
 * Needs AI_PROVIDER=gemini and GEMINI_API_KEY. The mock provider only guesses sentiment from
 * the star rating, so it is refused unless you pass --allow-mock. Sends redacted text only.
 * Safe to run while `npm run dev` is up; the dashboard picks up the new tags within 5 minutes.
 */
import { openDb } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { getProvider } from "@/lib/ai";
import { PROMPT_VERSION } from "@/lib/ai/provider";
import { aiTag, aiTagVersion, countCandidates, type TagScope } from "@/lib/ai/tagging";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const scope = (arg("scope") ?? "both") as TagScope;
  if (!["untagged", "conflict", "both"].includes(scope)) throw new Error("--scope must be untagged, conflict or both.");
  const limit = Number(arg("limit") ?? 200);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20_000) throw new Error("--limit must be a whole number from 1 to 20000.");
  const provider = getProvider();
  const conn = openDb();
  try {
    const waiting = countCandidates(conn, scope, aiTagVersion(provider));
    console.log(`${provider.label}: ${waiting.toLocaleString()} reviews waiting (scope ${scope}).`);
    if (process.argv.includes("--count")) return;
    if (provider.name === "mock" && !process.argv.includes("--allow-mock")) {
      throw new Error("AI_PROVIDER is mock, which cannot really tag reviews. Set AI_PROVIDER=gemini and GEMINI_API_KEY in .env.local (or pass --allow-mock to test the pipeline).");
    }
    const started = Date.now();
    const stats = await aiTag(conn, provider, {
      scope, limit,
      onProgress: (d, t) => process.stdout.write(`\r${d.toLocaleString()} / ${t.toLocaleString()} reviews`),
    });
    const ms = Date.now() - started;
    appendAudit(conn, {
      role: "system", action: "ai_tag", entityType: "reviews", status: stats.failedBatches ? "partial" : "ok",
      aiProvider: provider.name, aiModel: provider.model, aiVersion: PROMPT_VERSION,
      details: { ...stats, limit, durationMs: ms, via: "cli" },
    });
    console.log(
      `\nAI-tagged ${stats.reviews.toLocaleString()} reviews in ${(ms / 1000).toFixed(1)} s: ${stats.themesAdded.toLocaleString()} themes added, ` +
        `${stats.sentimentDisagreements.toLocaleString()} sentiment disagreements with the rules. ${stats.remaining.toLocaleString()} still waiting.`,
    );
    if (stats.failedBatches) console.log(`${stats.failedBatches} batch(es) failed and will be retried next run. Last error: ${stats.lastError}`);
  } finally {
    conn.close();
  }
}

main().catch((err) => {
  console.error(`\n[ai-tag] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
