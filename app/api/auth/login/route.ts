import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, type Role } from "@/lib/auth/session";
import { requestMeta, sameOrigin } from "@/lib/auth/guard";
import { clearLoginAttempts, loginRetryAfter, recordFailedLogin } from "@/lib/auth/rateLimit";

// Compared against when the email is unknown, so timing does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-0"));

export async function POST(req: NextRequest) {
  // No session yet, so CSRF protection here is the Origin check plus the SameSite=Strict cookie.
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin." }, { status: 403 });
  const meta = requestMeta(req);
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

  const limitKey = `${meta.ip}|${email}`;
  const retryAfter = loginRetryAfter(limitKey);
  if (retryAfter > 0) {
    appendAudit(db(), { action: "login_rate_limited", details: { email }, ...meta, status: "denied" });
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const user = db()
    .prepare("SELECT id, role, password_hash, must_change_password, disabled FROM users WHERE email = ?")
    .get(email) as
    | { id: number; role: Role; password_hash: string; must_change_password: number; disabled: number }
    | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));

  if (!user || !ok || user.disabled) {
    recordFailedLogin(limitKey);
    appendAudit(db(), {
      userId: user?.id ?? null, action: "login_failed", details: { email }, ...meta, status: "denied",
    });
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  clearLoginAttempts(limitKey);
  const { csrfToken } = await createSession(user.id);
  appendAudit(db(), { userId: user.id, role: user.role, action: "login", entityType: "user", entityId: String(user.id), ...meta });
  return NextResponse.json({ csrfToken, mustChangePassword: user.must_change_password === 1 });
}
