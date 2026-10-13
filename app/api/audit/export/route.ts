import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { auditCsv, AuditQueryError, parseAuditQuery } from "@/lib/auditQuery";

/** IT officers: the filtered audit log as CSV (same filters as /api/audit). Audited before the download starts. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  try {
    const q = parseAuditQuery(req.nextUrl.searchParams, null);
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "audit_export", entityType: "audit_log",
      details: { filters: Object.fromEntries(Object.entries(q).filter(([k, v]) => v !== null && k !== "limit" && k !== "offset")) }, ...requestMeta(req),
    });
    const rows = auditCsv(db(), q);
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // A batch of rows per pull keeps memory flat on large logs.
        for (let i = 0; i < 500; i++) {
          const next = rows.next();
          if (next.done) return controller.close();
          controller.enqueue(enc.encode(next.value));
        }
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AuditQueryError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
