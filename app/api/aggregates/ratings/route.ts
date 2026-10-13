import type { NextRequest } from "next/server";
import { ratingSummary } from "@/lib/insights/ratings";
import { readRoute } from "@/lib/insights/route";

/** Star-rating breakdown for the filters (ignoring the rating, comments and photos filters, so each chip can show its count). */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => ratingSummary(conn, f), { cache: true });
}
