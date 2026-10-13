import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { createUser, listUsers, UserError } from "@/lib/admin/users";

/** IT officers: every account with role, state, last sign-in and active sessions. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ users: listUsers(db()), you: auth.user.id }, { headers: { "Cache-Control": "no-store" } });
}

/** IT officers: { email, displayName, role } → new account with a one-time temporary password (returned once, never logged). */
export async function POST(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const user = await createUser(db(), { email: body.email, displayName: body.displayName, role: body.role });
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "user_create", entityType: "user", entityId: String(user.id),
      details: { email: user.email, role: user.role }, ...requestMeta(req),
    });
    return NextResponse.json(user, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
