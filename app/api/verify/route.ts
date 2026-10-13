import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { bumpDataVersion } from "@/lib/insights/cache";
import { enumParam, intParam, ParamError, readRoute } from "@/lib/insights/route";
import { queue, verify, VerifyError } from "@/lib/verify";

/**
 * The verification queue. Usual filters, plus:
 *   threshold=0.75 (or "off")   include reviews below this sentiment confidence
 *   mixed=true, disagree=true   include mixed wording / stars-disagree reviews
 *   (not "conflict": that is the global rating/text conflict filter)
 *   sort=uncertain|newest|rating_low|rating_high, limit (≤ 50), offset
 */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f, sp) => {
    const raw = sp.get("threshold") ?? "0.75";
    const threshold = raw === "off" ? null : Number(raw);
    if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0.3 || threshold > 1)) throw new ParamError('"threshold" must be between 0.3 and 1, or "off".');
    return queue(conn, f, {
      threshold,
      mixed: sp.get("mixed") === "true",
      conflict: sp.get("disagree") === "true",
      sort: enumParam(sp, "sort", ["uncertain", "newest", "rating_low", "rating_high"] as const, "uncertain"),
      limit: intParam(sp, "limit", 20, 1, 50),
      offset: intParam(sp, "offset", 0, 0, 1_000_000),
    });
  });
}

/** { reviewId, verdict: positive | neutral | negative | unreadable }. Replaces the automatic label everywhere; audited. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as { reviewId?: unknown; verdict?: unknown };
  const reviewId = Number(body.reviewId);
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ error: "Give a review id." }, { status: 400 });
  try {
    const result = verify(db(), auth.user.id, reviewId, body.verdict);
    bumpDataVersion();
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "review_verify", entityType: "review", entityId: String(reviewId),
      details: { verdict: result.verdict, previous: result.previous }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof VerifyError) return NextResponse.json({ error: err.message }, { status: err.message === "Review not found." ? 404 : 409 });
    throw err;
  }
}
