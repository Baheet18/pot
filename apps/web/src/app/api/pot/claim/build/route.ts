import { buildClaim } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    return Response.json(await buildClaim(b.kind === "creator" ? "creator" : "win", str(b.wallet), str(b.marketId)));
  } catch (e) { return errorResponse(e); }
}
