import { FlowError, startCreate, verify } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const t = verify<{ d: string; u?: number }>(str(b.token));
    if (!t || t.d !== str(b.draftId)) throw new FlowError(401, "BAD_TOKEN", "This create link expired. Tap ✅ Create in the group again.");
    return Response.json(await startCreate(t.d, str(b.wallet), t.u));
  } catch (e) { return errorResponse(e); }
}
