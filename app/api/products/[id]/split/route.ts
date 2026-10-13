import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { bumpDataVersion } from "@/lib/insights/cache";
import { MappingEditError, splitProduct } from "@/lib/mapping/edit";

/** Split alternate names (and their reviews) off into a new product: { aliasIds: [], name? }. Audited. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  const body = (await req.json().catch(() => null)) as { aliasIds?: unknown; name?: unknown } | null;
  const aliasIds = Array.isArray(body?.aliasIds) ? body.aliasIds.map(Number) : [];
  if (!Number.isInteger(id) || id <= 0 || !aliasIds.length || !aliasIds.every((n) => Number.isInteger(n) && n > 0)) {
    return NextResponse.json({ error: "Pick the alternate names to split off." }, { status: 400 });
  }
  try {
    const result = splitProduct(db(), id, aliasIds, typeof body?.name === "string" ? body.name : null);
    bumpDataVersion();
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "mapping_split", entityType: "product", entityId: String(id),
      details: { ...result, aliasIds }, ...requestMeta(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MappingEditError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
