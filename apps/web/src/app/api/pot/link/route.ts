import { verifyAndLink } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    return Response.json(await verifyAndLink(str(b.token), str(b.wallet), str(b.signature)));
  } catch (e) { return errorResponse(e); }
}
