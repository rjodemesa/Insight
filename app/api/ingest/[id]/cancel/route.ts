import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  const info = db()
    .prepare("UPDATE ingest_jobs SET cancel_requested = 1 WHERE id = ? AND status IN ('queued','running')")
    .run(id);
  if (info.changes === 0) return NextResponse.json({ error: "This import is not running." }, { status: 409 });
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "ingest_cancel_requested",
    entityType: "ingest", entityId: String(id), ...requestMeta(req),
  });
  return NextResponse.json({ ok: true });
}
