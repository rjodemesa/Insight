import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, safeEqual, type Role, type Session } from "./session";

export interface GuardOptions {
  /** Restrict to these roles. Omit to allow any signed-in user. */
  roles?: Role[];
  /** Allow users who still have to change their password (only the change-password route). */
  allowPendingPasswordChange?: boolean;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

export function requestMeta(req: NextRequest): RequestMeta {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: fwd || req.headers.get("x-real-ip") || "local",
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  };
}

const json = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Rejects cross-site requests. Browsers always send Origin on POST/PUT/PATCH/DELETE. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const isMutation = (m: string) => !["GET", "HEAD", "OPTIONS"].includes(m);

/**
 * Server-side gate for every protected API route:
 *   const auth = await guard(req, { roles: ["it_officer"] });
 *   if (auth instanceof NextResponse) return auth;
 */
export async function guard(req: NextRequest, opts: GuardOptions = {}): Promise<Session | NextResponse> {
  const session = await getSession();
  if (!session) return json(401, "Not signed in.");
  if (session.user.mustChangePassword && !opts.allowPendingPasswordChange) {
    return json(403, "Password change required.");
  }
  if (opts.roles && !opts.roles.includes(session.user.role)) return json(403, "Not allowed for your role.");
  if (isMutation(req.method)) {
    const token = req.headers.get("x-csrf-token") ?? "";
    if (!sameOrigin(req) || !safeEqual(token, session.csrfToken)) return json(403, "CSRF check failed.");
  }
  return session;
}
