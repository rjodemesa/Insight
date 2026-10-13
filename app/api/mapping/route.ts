import type { NextRequest } from "next/server";
import { mappingReview } from "@/lib/mapping/edit";
import { intParam, readRoute } from "@/lib/insights/route";

/** Products to review for mapping mistakes, weakest matches first. q searches name and brand. */
export function GET(req: NextRequest) {
  return readRoute(req, (conn, _f, sp) =>
    mappingReview(conn, {
      q: sp.get("q")?.trim().slice(0, 100) || null,
      limit: intParam(sp, "limit", 25, 1, 100),
      offset: intParam(sp, "offset", 0, 0, 100_000),
    }),
  );
}
