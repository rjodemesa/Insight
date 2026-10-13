import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { db, DB_PATH } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { getSession } from "@/lib/auth/session";
import { providerStatus } from "@/lib/ai";

/** Public liveness check. IT officers also get system details. */
export async function GET(_req: NextRequest) {
  const conn = db();
  const session = await getSession();
  if (session?.user.role !== "it_officer" || session.user.mustChangePassword) {
    return NextResponse.json({ status: "ok" });
  }
  const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  return NextResponse.json({
    status: "ok",
    schemaVersion: conn.pragma("user_version", { simple: true }),
    dbBytes: size(DB_PATH) + size(`${DB_PATH}-wal`),
    ai: providerStatus(),
    piiVaultKeyConfigured: Boolean(process.env.PII_VAULT_KEY),
    auditChain: verifyAuditChain(conn),
    users: (conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
  });
}
