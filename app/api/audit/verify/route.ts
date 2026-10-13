import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit, verifyAuditChain } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";

/** IT officers: re-hash the whole chain and report the first entry that was altered, if any. The check itself is audited. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const started = Date.now();
  const result = verifyAuditChain(db());
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "audit_verify", entityType: "audit_log",
    status: result.ok ? "ok" : "failed", details: { ...result, ms: Date.now() - started }, ...requestMeta(req),
  });
  return NextResponse.json({ ...result, checkedAt: new Date().toISOString() });
}
