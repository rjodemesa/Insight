import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { getProvider } from "@/lib/ai";
import { ask, MAX_QUESTION, type Turn } from "@/lib/ai/ask";
import { auditAi, aiFailure, bodyFilters, limited } from "@/lib/ai/route";

/**
 * Ask AI: { question, query, history }. `query` is the filter query string; `history` is
 * up to 4 earlier { question, answer } turns, used as context only. The audit log keeps
 * the question's length, not its text.
 */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as { question?: unknown; query?: unknown; history?: unknown };
  const question = typeof body.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (!question) return NextResponse.json({ error: "Type a question." }, { status: 400 });
  if (question.length > MAX_QUESTION) return NextResponse.json({ error: `Keep the question under ${MAX_QUESTION} characters.` }, { status: 400 });
  const history: Turn[] = (Array.isArray(body.history) ? body.history : [])
    .slice(-4)
    .map((t) => {
      const x = (t ?? {}) as Partial<Turn>;
      return { question: String(x.question ?? "").slice(0, 300), answer: String(x.answer ?? "").slice(0, 800) };
    })
    .filter((t) => t.question && t.answer);
  const provider = getProvider();
  try {
    const { f, key } = bodyFilters(body.query);
    const tooMany = limited(auth.user.id);
    if (tooMany) return tooMany;
    const { body: answer, result, sent } = await ask(db(), f, question, history, provider);
    auditAi(req, auth, "ai_ask", provider, result, {
      filters: key, questionChars: question.length, historyTurns: history.length, ...sent,
      citedFacts: answer.answer.facts.length, citedReviews: answer.answer.reviews, insufficient: answer.insufficient,
      droppedCitations: answer.droppedCitations,
    });
    return NextResponse.json(
      { ...answer, provider: provider.name, label: provider.label, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    auditAi(req, auth, "ai_ask", provider, null, { questionChars: question.length, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "failed");
    return aiFailure(err, "ai_ask_failed");
  }
}
