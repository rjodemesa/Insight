import type { NextRequest } from "next/server";
import { operations } from "@/lib/insights/operations";
import { readRoute } from "@/lib/insights/route";

/** Latest import's data-quality score and processing time, and the assumptions behind ESTIMATED figures. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn) => operations(conn));
}
