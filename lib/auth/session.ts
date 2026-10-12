import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { isProduction, sessionSecret } from "@/lib/env";

export type Role = "user" | "it_officer";

export interface SessionUser {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  mustChangePassword: boolean;
}

export interface Session {
  user: SessionUser;
  csrfToken: string;
  idHash: string;
}

export const SESSION_COOKIE = "insight_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one working day

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const sign = (id: string) => crypto.createHmac("sha256", sessionSecret()).update(id).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Creates a session row and sets the signed, httpOnly cookie. */
export async function createSession(userId: number): Promise<{ csrfToken: string }> {
  const id = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  db()
    .prepare("INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256(id), userId, csrfToken, expires.toISOString());
  (await cookies()).set(SESSION_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    expires,
  });
  return { csrfToken };
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac || !safeEqual(mac, sign(id))) return null;
  const row = db()
    .prepare(
      `SELECT s.id_hash, s.csrf_token, s.expires_at, u.id, u.email, u.display_name, u.role,
              u.must_change_password, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .get(sha256(id)) as
    | { id_hash: string; csrf_token: string; expires_at: string; id: number; email: string;
        display_name: string | null; role: Role; must_change_password: number; disabled: number }
    | undefined;
  if (!row || row.disabled || new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    idHash: row.id_hash,
    csrfToken: row.csrf_token,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
    },
  };
}

export async function destroySession(idHash?: string): Promise<void> {
  if (idHash) db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  (await cookies()).delete(SESSION_COOKIE);
}

/** Ends every session for a user (password change, disable, role change). */
export function destroyAllSessionsFor(userId: number): void {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export { safeEqual };
