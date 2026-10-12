import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { QUALITY_SCORE_FORMULA } from "@/lib/ingest/quality";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const job = db()
    .prepare(
      `SELECT id, filename, status, stage, source_kind, file_bytes, progress, processed_rows, total_rows,
              cancel_requested, error, quality_report, started_at, finished_at
       FROM ingest_jobs WHERE id = ?`,
    )
    .get(id) as (Record<string, unknown> & { quality_report: string | null }) | undefined;
  if (!job) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { quality_report, ...rest } = job;
  return NextResponse.json({
    job: rest,
    quality: quality_report ? JSON.parse(quality_report) : null,
    qualityFormula: QUALITY_SCORE_FORMULA,
  });
}
