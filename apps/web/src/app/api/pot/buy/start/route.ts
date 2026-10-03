import { startBuy } from "@pot/server";
import { body, errorResponse, num, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const r = await startBuy({ marketId: str(b.marketId), side: str(b.side), amountUsdc: num(b.amountUsdc), wallet: str(b.wallet), ref: str(b.ref) || null, rs: str(b.rs) || null });
    return Response.json({ orderId: r.orderId, quoteId: r.quoteId, side: r.side, amountUsdc: r.amountUsdc, shares: r.shares, feeUsdc: r.feeUsdc, paysAboutIfRight: r.paysAboutIfRight, transaction: r.transaction, sandbox: r.sandbox, sandboxMemo: r.sandboxMemo });
  } catch (e) { return errorResponse(e); }
}
