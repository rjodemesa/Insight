import type { NextRequest } from "next/server";
import { themes } from "@/lib/insights/queries";
import { intParam, readRoute } from "@/lib/insights/route";

/** Theme and Five Vector counts with sentiment, plus change in the last `days` (default 30) vs the 3×days before. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f, sp) => themes(conn, f, intParam(sp, "days", 30, 7, 365)), { cache: true });
}
