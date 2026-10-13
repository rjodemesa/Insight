import type { NextRequest } from "next/server";
import { readRoute } from "@/lib/insights/route";
import { recentVerifications, reliabilityBands } from "@/lib/verify";

/** Reliability by confidence band for the filters, and the latest verdicts (for Undo). */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => ({ reliability: reliabilityBands(conn, f), recent: recentVerifications(conn) }));
}
