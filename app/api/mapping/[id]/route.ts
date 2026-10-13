import type { NextRequest } from "next/server";
import { aliasesOf } from "@/lib/mapping/edit";
import { ParamError, readRoute } from "@/lib/insights/route";

/** A product's alternate names with ids, for choosing what to split off. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return readRoute(req, (conn) => {
    if (!Number.isInteger(id) || id <= 0) throw new ParamError("Bad product id.");
    const product = conn.prepare("SELECT id, canonical_name AS name, brand, category, size_token AS size FROM products WHERE id = ?").get(id);
    return product ? { product, aliases: aliasesOf(conn, id) } : null;
  });
}
