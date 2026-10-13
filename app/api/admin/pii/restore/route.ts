import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { piiVaultKey } from "@/lib/env";
import { bumpDataVersion } from "@/lib/insights/cache";
import { PiiError, restoreTokens } from "@/lib/admin/pii";

/**
 * IT officers: { reviewId, tokens, reason } puts wrongly redacted originals back into the
 * review text for everyone to see. Requires a reason; audited with the tokens, never the values.
 */
export async function POST(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as { reviewId?: unknown; tokens?: unknown; reason?: unknown };
  const reviewId = Number(body.reviewId);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ error: "Give a review id." }, { status: 400 });
  if (reason.length < 10) return NextResponse.json({ error: "Give a reason of at least 10 characters." }, { status: 400 });
  try {
    const result = restoreTokens(db(), piiVaultKey(), reviewId, Array.isArray(body.tokens) ? (body.tokens as string[]).slice(0, 50) : []);
    bumpDataVersion();
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "pii_restore", entityType: "review", entityId: String(reviewId),
      details: { reason, restored: result.restored }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PiiError) return NextResponse.json({ error: err.message }, { status: err.message === "Review not found." ? 404 : 400 });
    throw err;
  }
}
