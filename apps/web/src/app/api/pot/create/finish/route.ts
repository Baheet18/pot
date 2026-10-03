import { FlowError, finishCreate, verify } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const t = verify<{ d: string }>(str(b.token));
    if (!t || t.d !== str(b.draftId)) throw new FlowError(401, "BAD_TOKEN", "This create link expired.");
    return Response.json(await finishCreate(t.d, str(b.createId), str(b.signature)));
  } catch (e) { return errorResponse(e); }
}
