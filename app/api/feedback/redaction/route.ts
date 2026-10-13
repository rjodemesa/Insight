import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { addRedactionFlag, FeedbackError } from "@/lib/feedback";

/** "Missed personal info?": { reviewId, note }. Feeds the redaction-rules list; audited without the note text. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const result = addRedactionFlag(db(), auth.user.id, { reviewId: body.reviewId, note: body.note });
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "redaction_flag", entityType: "review", entityId: String(result.reviewId),
      details: { flagId: result.id }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FeedbackError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
