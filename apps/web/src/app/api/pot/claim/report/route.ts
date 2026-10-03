import { reportClaim } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    return Response.json(await reportClaim(str(b.wallet), str(b.marketId), str(b.signature)));
  } catch (e) { return errorResponse(e); }
}
