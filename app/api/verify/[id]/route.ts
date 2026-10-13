import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { bumpDataVersion } from "@/lib/insights/cache";
import { unverify, VerifyError } from "@/lib/verify";

/** Undo a verification: the automatic label comes back. Audited. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  try {
    const result = unverify(db(), id);
    bumpDataVersion();
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "review_unverify", entityType: "review", entityId: String(id),
      details: { restored: result.restored }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof VerifyError) return NextResponse.json({ error: err.message }, { status: err.message === "Review not found." ? 404 : 409 });
    throw err;
  }
}
