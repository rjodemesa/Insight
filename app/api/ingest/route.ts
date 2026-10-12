import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { guard, requestMeta } from "@/lib/auth/guard";
import { enqueueIngest, recoverStaleJobs } from "@/lib/ingest/jobs";
import { detectKind, hasAllowedExtension, MAX_UPLOAD_BYTES, type SourceKind } from "@/lib/ingest/readers";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

function expectedKind(name: string): SourceKind {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx")) return "xlsx";
  if (n.endsWith(".gz")) return "csv.gz";
  return "csv";
}

/** Upload: the raw file is the request body; its name is in the X-File-Name header. */
export async function POST(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const meta = requestMeta(req);

  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "").replace(/[\\/]/g, "_").slice(0, 200);
  if (!name || !hasAllowedExtension(name)) return bad(400, "Upload an .xlsx, .csv or .csv.gz file.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return bad(413, `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  if (!req.body) return bad(400, "The upload was empty.");

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = path.join(UPLOAD_DIR, `${crypto.randomUUID()}.upload`);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _e, cb) {
      bytes += chunk.length;
      cb(bytes > MAX_UPLOAD_BYTES ? new Error("too_large") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body as never), limiter, fs.createWriteStream(stored));
  } catch (err) {
    fs.rmSync(stored, { force: true });
    return err instanceof Error && err.message === "too_large"
      ? bad(413, "The file is too large.")
      : bad(400, "The upload was interrupted.");
  }

  const head = Buffer.alloc(8);
  const fd = fs.openSync(stored, "r");
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  const kind = detectKind(head.subarray(0, Math.min(8, bytes)));
  if (!kind || kind !== expectedKind(name)) {
    fs.rmSync(stored, { force: true });
    return bad(400, "The file's contents do not match its extension. Upload a real .xlsx, .csv or .csv.gz file.");
  }

  recoverStaleJobs();
  const info = db()
    .prepare(
      "INSERT INTO ingest_jobs (filename, status, stage, source_kind, stored_path, file_bytes, started_by) VALUES (?, 'queued', 'queued', ?, ?, ?, ?)",
    )
    .run(name, kind, stored, bytes, auth.user.id);
  const jobId = Number(info.lastInsertRowid);
  appendAudit(db(), {
    userId: auth.user.id, role: auth.user.role, action: "upload", entityType: "ingest", entityId: String(jobId),
    details: { filename: name, bytes, kind }, ...meta,
  });
  enqueueIngest({ jobId, path: stored, kind, userId: auth.user.id, role: auth.user.role });
  return NextResponse.json({ jobId }, { status: 202 });
}

/** Ingest history, newest first. */
export async function GET(req: NextRequest) {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  recoverStaleJobs();
  const jobs = db()
    .prepare(
      `SELECT j.id, j.filename, j.status, j.stage, j.source_kind, j.file_bytes, j.progress, j.processed_rows,
              j.total_rows, j.error, j.started_at, j.finished_at, u.email AS started_by
       FROM ingest_jobs j LEFT JOIN users u ON u.id = j.started_by ORDER BY j.id DESC LIMIT 50`,
    )
    .all();
  return NextResponse.json({ jobs });
}
