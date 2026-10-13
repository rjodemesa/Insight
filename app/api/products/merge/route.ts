import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { bumpDataVersion } from "@/lib/insights/cache";
import { MappingEditError, mergeProducts } from "@/lib/mapping/edit";

/** Merge products into one: { targetId, sourceIds: [] }. Audited. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as { targetId?: unknown; sourceIds?: unknown } | null;
  const targetId = Number(body?.targetId);
  const sourceIds = Array.isArray(body?.sourceIds) ? body.sourceIds.map(Number) : [];
  if (!Number.isInteger(targetId) || targetId <= 0 || !sourceIds.every((n) => Number.isInteger(n) && n > 0)) {
    return NextResponse.json({ error: "Give a target product and the products to merge into it." }, { status: 400 });
  }
  try {
    const result = mergeProducts(db(), targetId, sourceIds);
    bumpDataVersion();
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "mapping_merge", entityType: "product", entityId: String(targetId),
      details: result, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MappingEditError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
