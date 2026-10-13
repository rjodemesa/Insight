import type { NextRequest } from "next/server";
import { filterOptions } from "@/lib/insights/queries";
import { readRoute } from "@/lib/insights/route";

/** Values for the filter controls (retailers, brands, themes, date range, …). */
export function GET(req: NextRequest) {
  return readRoute(req, (conn) => filterOptions(conn));
}
