import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth/guard";
import type { Session } from "@/lib/auth/session";
import { canonicalFilterQuery, FilterError, parseFilters, type Filters } from "@/lib/query/filters";
import { log } from "@/lib/log";
import { aiRetryAfter } from "./memo";
import { AIError, PROMPT_VERSION, type AIProvider, type AIResult } from "./provider";

/** Shared plumbing for the AI routes: filters from the body, the per-user limit, audit and errors. */

export function bodyFilters(query: unknown): { f: Filters; key: string } {
  const sp = new URLSearchParams(typeof query === "string" ? query.slice(0, 4000) : "");
  return { f: parseFilters(sp), key: canonicalFilterQuery(sp) };
}

/** 429 with Retry-After when the user is over the AI request limit, else null. */
export function limited(userId: number): NextResponse | null {
  const wait = aiRetryAfter(userId);
  return wait > 0
    ? NextResponse.json({ error: `Too many AI requests. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { "Retry-After": String(wait) } })
    : null;
}

/** Audits one AI call: provider, model, prompt version and prompt hash, plus `details` (never review text or the question). */
export function auditAi(req: NextRequest, auth: Session, action: string, provider: AIProvider, result: AIResult<unknown> | null, details: Record<string, unknown>, status = "ok") {
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action, entityType: "ai", status,
    aiProvider: provider.name, aiModel: provider.model, aiVersion: PROMPT_VERSION, promptHash: result?.promptHash ?? null,
    details: { ...details, ...(result ? { ms: result.ms, tokens: result.tokens } : {}) },
    ...requestMeta(req),
  });
}

const STATUS: Record<AIError["code"], number> = {
  not_configured: 503, timeout: 504, rate_limited: 429, blocked: 422, bad_response: 502, upstream: 502,
};

/** Maps a failure to a response. AI and filter errors explain themselves; anything else is logged. */
export function aiFailure(err: unknown, event: string): NextResponse {
  if (err instanceof FilterError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof AIError) return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
  log("error", event, { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
  return NextResponse.json({ error: "The AI request failed. Check the server log." }, { status: 500 });
}
