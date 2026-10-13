import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { AuditQueryError, listAudit, parseAuditQuery } from "@/lib/auditQuery";

/**
 * Audit log, newest first. Users get their own entries only; IT officers get everyone's
 * and may filter by `user`. Other filters: action, status, entityType, from, to (UTC dates), limit, offset.
 */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const q = parseAuditQuery(req.nextUrl.searchParams, auth.user.role === "it_officer" ? null : auth.user.id);
    return NextResponse.json({ scope: auth.user.role === "it_officer" ? "all" : "own", ...listAudit(db(), q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AuditQueryError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
