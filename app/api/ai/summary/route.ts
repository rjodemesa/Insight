import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { getProvider } from "@/lib/ai";
import { recall, remember } from "@/lib/ai/memo";
import { auditAi, aiFailure, bodyFilters, limited } from "@/lib/ai/route";
import { aiSummary, type AISummary } from "@/lib/ai/summary";

type SummaryResponse = AISummary & { provider: string; label: string; generatedAt: string; cached: boolean };

/**
 * AI summary of the Dashboard for { query } (the page's filter query string). The same
 * filters reuse the last answer for an hour unless { refresh: true }. Every model call is audited.
 */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as { query?: unknown; refresh?: unknown };
  const provider = getProvider();
  try {
    const { f, key } = bodyFilters(body.query);
    const memoKey = `summary:${provider.name}:${provider.model}:${key}`;
    const hit = body.refresh === true ? undefined : recall<SummaryResponse>(memoKey);
    if (hit) return NextResponse.json({ ...hit, cached: true }, { headers: { "Cache-Control": "no-store" } });
    const tooMany = limited(auth.user.id);
    if (tooMany) return tooMany;
    const { body: summary, result, sent } = await aiSummary(db(), f, key, provider);
    auditAi(req, auth, "ai_summary", provider, result, {
      filters: key, ...sent, points: summary.points.length, droppedCitations: summary.droppedCitations,
    });
    const out: SummaryResponse = { ...summary, provider: provider.name, label: provider.label, generatedAt: new Date().toISOString(), cached: false };
    remember(memoKey, out);
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    auditAi(req, auth, "ai_summary", provider, null, { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "failed");
    return aiFailure(err, "ai_summary_failed");
  }
}
