import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { EXPORT_KINDS, exportWorkbook, type ExportKind } from "@/lib/export/excel";
import { describeFilters, FilterError, parseFilters } from "@/lib/query/filters";
import { log } from "@/lib/log";

/**
 * Excel download of the current filtered view: ?kind=reviews|products|brands|retailers|themes|trend
 * plus the usual filters. Redacted text only, for every role. Audited when the file finishes.
 */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") ?? "reviews") as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of: ${EXPORT_KINDS.join(", ")}.` }, { status: 400 });
  let filters;
  try {
    filters = parseFilters(sp);
  } catch (err) {
    if (err instanceof FilterError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const meta = requestMeta(req);
  const { stream, done } = exportWorkbook(db(), kind, filters, auth.user.email);
  const audit = (status: string, rows: number | null) =>
    appendAudit(db(), {
      userId: auth.user.id, role: auth.user.role, action: "export", entityType: "export", entityId: kind,
      details: { kind, rows, filters: describeFilters(filters) }, status, ...meta,
    });
  done.then(
    (rows) => audit("ok", rows),
    (err) => {
      audit("failed", null);
      log("error", "export_failed", { kind, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    },
  );

  const date = new Date().toISOString().slice(0, 10);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="insight-${kind}-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
