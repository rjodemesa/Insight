import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { updateUser, UserError } from "@/lib/admin/users";

/** IT officers: { role?, disabled?, displayName? }. Role changes and disabling end the user's sessions. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "User not found." }, { status: 404 });
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const result = updateUser(db(), auth.user.id, id, { role: body.role, disabled: body.disabled, displayName: body.displayName });
    if (Object.keys(result.changes).length) {
      appendAudit(db(), {
        userId: auth.user.id, role: auth.user.role, action: "user_update", entityType: "user", entityId: String(id),
        details: { email: result.email, changes: result.changes, sessionsEnded: result.endSessions }, ...requestMeta(req),
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: err.message === "User not found." ? 404 : 400 });
    throw err;
  }
}
