import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { piiVaultKey } from "@/lib/env";
import { revealRecord } from "@/lib/redact/vault";

/** IT officer only: decrypt one review's redacted originals. Requires a typed reason; always audited. */
export async function POST(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { reviewId?: unknown; reason?: unknown } | null;
  const reviewId = Number(body?.reviewId);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!Number.isInteger(reviewId) || reviewId <= 0) return NextResponse.json({ error: "Give a review id." }, { status: 400 });
  if (reason.length < 10) return NextResponse.json({ error: "Give a reason of at least 10 characters." }, { status: 400 });

  const record = revealRecord(db(), piiVaultKey(), reviewId);
  // Logged whether or not the record exists. The reason is stored; the revealed values are not.
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "pii_reveal", entityType: "review",
    entityId: String(reviewId), details: { reason, tokens: record?.tokens.length ?? 0 },
    status: record ? "ok" : "not_found", ...requestMeta(req),
  });
  if (!record) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
}
