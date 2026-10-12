import { NextResponse, type NextRequest } from "next/server";
import { guard } from "@/lib/auth/guard";

export async function GET(req: NextRequest) {
  const auth = await guard(req, { allowPendingPasswordChange: true });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ user: auth.user, csrfToken: auth.csrfToken });
}
