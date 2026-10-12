import fs from "node:fs";
import zlib from "node:zlib";
import { Transform } from "node:stream";
import ExcelJS from "exceljs";
import { parseCsv } from "./csv";

export type SourceKind = "xlsx" | "csv" | "csv.gz";

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

/** Decides the format from the file's first bytes, so a renamed file cannot fool the parser. */
export function detectKind(firstBytes: Buffer): SourceKind | null {
  if (firstBytes[0] === 0x50 && firstBytes[1] === 0x4b && firstBytes[2] === 0x03 && firstBytes[3] === 0x04) return "xlsx";
  if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) return "csv.gz";
  if (firstBytes.length > 0 && !firstBytes.includes(0)) return "csv";
  return null;
}

export const ALLOWED_EXTENSIONS = [".xlsx", ".csv", ".csv.gz", ".gz"];
export const hasAllowedExtension = (name: string) =>
  ALLOWED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/** Events from a reader: a header at the start of each sheet, then its rows. */
export type SourceEvent =
  | { type: "header"; sheet: string; cells: string[] }
  | { type: "row"; cells: string[] };

export interface OpenOptions {
  /** Called with the fraction (0–1) of the source file read so far. */
  onProgress?: (fraction: number) => void;
}

function countingStream(path: string, onProgress?: (f: number) => void) {
  const total = fs.statSync(path).size || 1;
  let read = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      read += chunk.length;
      onProgress?.(Math.min(1, read / total));
      cb(null, chunk);
    },
  });
  return fs.createReadStream(path, { highWaterMark: 256 * 1024 }).pipe(counter);
}

export async function* readSource(path: string, kind: SourceKind, opts: OpenOptions = {}): AsyncGenerator<SourceEvent> {
  if (kind === "xlsx") {
    yield* readXlsx(path, opts);
    return;
  }
  let stream: NodeJS.ReadableStream = countingStream(path, opts.onProgress);
  if (kind === "csv.gz") stream = stream.pipe(zlib.createGunzip());
  stream.setEncoding("utf8");
  let first = true;
  for await (const cells of parseCsv(stream as AsyncIterable<string>)) {
    if (first) {
      first = false;
      yield { type: "header", sheet: "csv", cells };
    } else yield { type: "row", cells };
  }
}

/** Converts an exceljs cell value (rich text, hyperlink, formula, date…) to plain text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return cellText(o.text);
    if (o.result !== undefined) return cellText(o.result);
    if (o.error) return "";
  }
  return String(v);
}

async function* readXlsx(path: string, opts: OpenOptions): AsyncGenerator<SourceEvent> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(countingStream(path, opts.onProgress), {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "emit",
  });
  for await (const sheet of reader) {
    const ws = sheet as unknown as AsyncIterable<{ values: unknown[] }> & { name?: string; id?: number };
    let first = true;
    for await (const row of ws) {
      // row.values is 1-based and sparse.
      const values = row.values;
      const cells: string[] = [];
      for (let i = 1; i < values.length; i++) cells.push(cellText(values[i]));
      if (first) {
        first = false;
        yield { type: "header", sheet: ws.name ?? `sheet${ws.id ?? ""}`, cells };
      } else yield { type: "row", cells };
    }
  }
}
