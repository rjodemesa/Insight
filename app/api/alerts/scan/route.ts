import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { getProvider } from "@/lib/ai";
import { runAgent } from "@/lib/agent/alerts";
import { auditAi, aiFailure, limited } from "@/lib/ai/route";

let running = false;

/** Runs the agent now: detects changes, has the AI write them up, and stores them as proposed alerts. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  if (running) return NextResponse.json({ error: "The agent is already running. Try again in a moment." }, { status: 409 });
  const tooMany = limited(auth.user.id);
  if (tooMany) return tooMany;
  const provider = getProvider();
  running = true;
  try {
    const started = Date.now();
    const stats = await runAgent(db(), provider);
    auditAi(req, auth, "agent_scan", provider, null, { ...stats, ms: Date.now() - started }, stats.aiError ? "partial" : "ok");
    return NextResponse.json(stats);
  } catch (err) {
    auditAi(req, auth, "agent_scan", provider, null, { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "failed");
    return aiFailure(err, "agent_scan_failed");
  } finally {
    running = false;
  }
}
