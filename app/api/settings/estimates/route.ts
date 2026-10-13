import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { getEstimates, setEstimates } from "@/lib/settings";

/** The editable assumptions behind ESTIMATED figures (e.g. minutes per manually reviewed record). */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ estimates: getEstimates(db()) });
}

/** Any signed-in user may change an assumption; the old and new values are audited. */
export async function PUT(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the values to change." }, { status: 400 });
  const before = getEstimates(db());
  const error = setEstimates(db(), body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const after = getEstimates(db());
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "settings_change", entityType: "settings", entityId: "estimates",
    details: { before, after }, ...requestMeta(req),
  });
  return NextResponse.json({ estimates: after });
}
