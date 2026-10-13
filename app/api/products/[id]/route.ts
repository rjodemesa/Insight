import type { NextRequest } from "next/server";
import { productDetail } from "@/lib/insights/queries";
import { ParamError, readRoute } from "@/lib/insights/route";

/** One product: aliases, score breakdown against its category, themes and monthly trend. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return readRoute(req, (conn, f) => {
    if (!Number.isInteger(id) || id <= 0) throw new ParamError("Bad product id.");
    return productDetail(conn, id, f);
  });
}
