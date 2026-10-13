/**
 * Runs the alert agent once, as the "Run agent now" button on the Alerts tab does.
 *   npm run agent
 * Schedule it (e.g. Windows Task Scheduler, daily after imports) to get new proposals
 * without opening the app. Proposed alerts still need a person to approve them.
 */
import { openDb } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { getProvider } from "@/lib/ai";
import { PROMPT_VERSION } from "@/lib/ai/provider";
import { runAgent } from "@/lib/agent/alerts";

async function main() {
  const provider = getProvider();
  const conn = openDb();
  try {
    const started = Date.now();
    const stats = await runAgent(conn, provider);
    appendAudit(conn, {
      role: "system", action: "agent_scan", entityType: "alerts", status: stats.aiError ? "partial" : "ok",
      aiProvider: provider.name, aiModel: provider.model, aiVersion: PROMPT_VERSION,
      details: { ...stats, ms: Date.now() - started, via: "cli" },
    });
    console.log(`Found ${stats.detected} changes; ${stats.alreadyProposed} were already proposed; ${stats.created} new alert(s) written by ${stats.writtenBy}.`);
    if (stats.aiError) console.log(`The AI write-up failed, so the new alerts use rule-written text: ${stats.aiError}`);
  } finally {
    conn.close();
  }
}

main().catch((err) => {
  console.error(`[agent] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
