import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { describeFilters, FilterError, parseFilters, type Filters } from "@/lib/query/filters";
import { log } from "@/lib/log";
import { cached, cacheKey } from "./cache";
import type Database from "better-sqlite3";

/**
 * Shared GET handler for the read APIs: signed-in users only, filters parsed from the
 * query string, bad input → 400, responses never cached (they hold review text).
 */
export async function readRoute(
  req: NextRequest,
  run: (conn: Database.Database, f: Filters, sp: URLSearchParams) => unknown,
  opts: { cache?: boolean } = {},
): Promise<NextResponse> {
  const auth = await guard(req);
  if (auth instanceof NextResponse) return auth;
  const sp = req.nextUrl.searchParams;
  try {
    const f = parseFilters(sp);
    const compute = () => run(db(), f, sp);
    // Same filters give the same answer for every user, so the cache is shared.
    const body = opts.cache ? cached(cacheKey(req.nextUrl.pathname, sp), compute) : compute();
    if (body === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ filters: describeFilters(f), ...(body as object) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof FilterError || err instanceof ParamError) return NextResponse.json({ error: err.message }, { status: 400 });
    log("error", "read_api_failed", { path: req.nextUrl.pathname, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
    return NextResponse.json({ error: "The query failed. Check the server log." }, { status: 500 });
  }
}

export class ParamError extends Error {}

export function intParam(sp: URLSearchParams, key: string, def: number, min: number, max: number): number {
  const v = sp.get(key);
  if (v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ParamError(`"${key}" must be a whole number from ${min} to ${max}.`);
  return n;
}

export function enumParam<T extends string>(sp: URLSearchParams, key: string, allowed: readonly T[], def: T): T {
  const v = sp.get(key);
  if (v === null || v === "") return def;
  if (!(allowed as readonly string[]).includes(v)) throw new ParamError(`"${key}" must be one of: ${allowed.join(", ")}.`);
  return v as T;
}
