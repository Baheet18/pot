import { confirmClaimPractice, reportClaim, SANDBOX } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    if (SANDBOX) return Response.json(confirmClaimPractice(b.kind === "creator" ? "creator" : "win", str(b.wallet), str(b.marketId), str(b.practiceMessage), str(b.practiceSignature)));
    return Response.json(await reportClaim(str(b.wallet), str(b.marketId), str(b.signature)));
  } catch (e) { return errorResponse(e); }
}
