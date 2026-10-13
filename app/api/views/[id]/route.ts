import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { deleteView } from "@/lib/views";

/** Delete one of your own saved views. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0 || !deleteView(db(), auth.user.id, id)) {
    return NextResponse.json({ error: "View not found." }, { status: 404 });
  }
  appendAudit(db(), { userId: auth.user.id, role: auth.user.role, action: "view_delete", entityType: "saved_view", entityId: String(id), ...requestMeta(req) });
  return NextResponse.json({ deleted: id });
}
