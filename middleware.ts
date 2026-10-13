import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge check for pages: no session cookie means go to /login. The real checks
 * (signature, expiry, role, CSRF) run server-side in the app layout and in guard() on
 * every API route. API routes are excluded here so large uploads are not buffered.
 */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/login" || req.cookies.has("prism_session")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|brand/).*)"],
};
