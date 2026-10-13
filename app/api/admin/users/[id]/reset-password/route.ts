import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { resetPassword, UserError } from "@/lib/admin/users";

/** IT officers: new one-time temporary password for another user; their sessions end and they must change it at sign-in. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "User not found." }, { status: 404 });
  try {
    const result = await resetPassword(db(), auth.user.id, id);
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "password_reset", entityType: "user", entityId: String(id),
      details: { email: result.email }, ...requestMeta(req),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.message === "User not found." ? 404 : 400 });
    throw err;
  }
}
