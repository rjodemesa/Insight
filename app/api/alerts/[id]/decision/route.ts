import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { decide, DecisionError } from "@/lib/agent/alerts";

/** Approve or dismiss a proposed alert: { decision: "approve" | "dismiss", note }. Final and audited. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  const body = ((await req.json().catch(() => null)) ?? {}) as { decision?: unknown; note?: unknown };
  try {
    const result = decide(db(), id, auth.user.id, body.decision, body.note);
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: result.status === "approved" ? "alert_approve" : "alert_dismiss",
      entityType: "alert", entityId: String(id), details: { note: result.note }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DecisionError) {
      return NextResponse.json({ error: err.message }, { status: err.message === "Alert not found." ? 404 : 409 });
    }
    throw err;
  }
}
