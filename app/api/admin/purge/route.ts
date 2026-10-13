import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { bumpDataVersion } from "@/lib/insights/cache";
import { listImports, purgeImport, PurgeError, purgeVault, vaultCounts } from "@/lib/admin/purge";

/** IT officers: imports that can be purged, and what the vault holds. */
export async function GET(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ imports: listImports(db()), vault: vaultCounts(db()) }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * IT officers, irreversible:
 *   { target: "import", id, confirm: <file name> }       deletes an import and everything derived from it
 *   { target: "vault", scope: "images" | "all", confirm: "PURGE VAULT" }   deletes vault originals
 */
export async function POST(req: NextRequest) {
  const auth = await guard(req, { roles: ["it_officer"] });
  if (auth instanceof NextResponse) return auth;
  const body = ((await req.json().catch(() => null)) ?? {}) as { target?: unknown; id?: unknown; scope?: unknown; confirm?: unknown };
  try {
    let details: Record<string, unknown>;
    if (body.target === "import") details = purgeImport(db(), Number(body.id), body.confirm);
    else if (body.target === "vault") details = purgeVault(db(), body.scope, body.confirm);
    else return NextResponse.json({ error: "target must be import or vault." }, { status: 400 });
    bumpDataVersion();
    db().pragma("wal_checkpoint(TRUNCATE)");
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: body.target === "import" ? "purge_import" : "purge_vault",
      entityType: body.target === "import" ? "ingest_job" : "pii_vault", entityId: body.target === "import" ? String(body.id) : String(body.scope),
      details, ...requestMeta(req),
    });
    return NextResponse.json(details);
  } catch (err) {
    if (err instanceof PurgeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
