import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { destroySession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const auth = await guard(req, { allowPendingPasswordChange: true });
  if (auth instanceof NextResponse) return auth;
  await destroySession(auth.idHash);
  appendAudit(db(), { userId: auth.user.id, role: auth.user.role, action: "logout", ...requestMeta(req) });
  return NextResponse.json({ ok: true });
}
