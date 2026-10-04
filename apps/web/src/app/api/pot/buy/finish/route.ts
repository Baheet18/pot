import { after } from "next/server";
import { runBotTicks } from "@/lib/telegram";
import { finishBuy } from "@pot/server";
import { body, errorResponse, num, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const r = await finishBuy({ orderId: str(b.orderId), quoteId: str(b.quoteId) || undefined, signature: str(b.signature), wallet: str(b.wallet), marketId: str(b.marketId), side: b.side === "no" ? "no" : "yes", amountUsdc: num(b.amountUsdc), ref: str(b.ref) || null, rs: str(b.rs) || null, channel: "web" });
    if (r.recorded) after(() => runBotTicks({ settle: false }));
    return Response.json(r);
  } catch (e) { return errorResponse(e); }
}
