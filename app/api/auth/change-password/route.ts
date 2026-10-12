import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyAllSessionsFor } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const auth = await guard(req, { allowPendingPasswordChange: true });
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword.slice(0, 200) : "";

  const row = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(auth.user.id) as
    | { password_hash: string }
    | undefined;
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }
  const policy = passwordPolicyError(next);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "Choose a different password." }, { status: 400 });

  db()
    .prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    )
    .run(await hashPassword(next), auth.user.id);
  // Sign out every other session, then issue a fresh one for this browser.
  destroyAllSessionsFor(auth.user.id);
  const { csrfToken } = await createSession(auth.user.id);
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "password_change",
    entityType: "user", entityId: String(auth.user.id), ...requestMeta(req),
  });
  return NextResponse.json({ ok: true, csrfToken });
}
