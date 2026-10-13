import type { NextRequest } from "next/server";
import { retailers } from "@/lib/insights/queries";
import { readRoute } from "@/lib/insights/route";

/** Retailer comparison with Intelligence Scores. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => retailers(conn, f));
}
