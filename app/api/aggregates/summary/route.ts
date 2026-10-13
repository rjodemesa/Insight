import type { NextRequest } from "next/server";
import { summary } from "@/lib/insights/queries";
import { readRoute } from "@/lib/insights/route";

/** KPI totals for the filtered reviews, with the Intelligence Score of the whole set. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, f) => summary(conn, f));
}
