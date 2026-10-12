import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge check: no session cookie means no access. The real checks
 * (signature, expiry, role, CSRF) run server-side in lib/auth/guard.ts and the app layout.
 */
const PUBLIC = ["/login", "/api/auth/login", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.cookies.has("insight_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
