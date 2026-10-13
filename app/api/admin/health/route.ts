import { NextResponse, type NextRequest } from "next/server";
import { db, DB_PATH } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { piiVaultKey } from "@/lib/env";
import { providerStatus } from "@/lib/ai";
import { systemHealth } from "@/lib/admin/health";

/** IT officers: health checks (schema, audit chain, vault key, AI, tagging, imports) and counts. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  let vaultKey: Buffer | null = null;
  let vaultKeyError: string | null = null;
  try {
    vaultKey = piiVaultKey();
  } catch (err) {
    vaultKeyError = err instanceof Error ? err.message : "PII_VAULT_KEY is not usable.";
  }
  return NextResponse.json(
    { ...systemHealth(db(), { dbPath: DB_PATH, vaultKey, vaultKeyError, ai: providerStatus() }), checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
