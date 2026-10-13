import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { FilterError } from "@/lib/query/filters";
import { listViews, saveView, ViewError } from "@/lib/views";

/** The user's own saved views plus the built-in persona presets. */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(listViews(db(), auth.user.id), { headers: { "Cache-Control": "no-store" } });
}

/** Save (or replace, by name) a view: { name, persona, filters: "<query string>" }. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const view = saveView(db(), auth.user.id, { name: body.name, persona: body.persona, filters: body.filters });
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "view_save", entityType: "saved_view", entityId: String(view.id),
      details: { name: view.name, persona: view.persona, filters: view.filters, replaced: view.replaced }, ...requestMeta(req),
    });
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof ViewError || err instanceof FilterError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
