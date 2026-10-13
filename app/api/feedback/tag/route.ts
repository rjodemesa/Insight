import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { addTagFeedback, FeedbackError } from "@/lib/feedback";

/** "Is this tag wrong?": { reviewId, theme, suggested, comment }. Stored for taxonomy improvement; audited. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const result = addTagFeedback(db(), auth.user.id, { reviewId: body.reviewId, theme: body.theme, suggested: body.suggested, comment: body.comment });
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "tag_feedback", entityType: "review", entityId: String(result.reviewId),
      details: { feedbackId: result.id, theme: result.theme, suggested: result.suggested }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FeedbackError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
