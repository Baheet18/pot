import { after } from "next/server";
import { runBotTicks } from "@/lib/telegram";
import { finishBuy, finishBuyPractice, SANDBOX } from "@pot/server";
import { body, errorResponse, num, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const common = { orderId: str(b.orderId), quoteId: str(b.quoteId) || undefined, wallet: str(b.wallet), marketId: str(b.marketId), side: (b.side === "no" ? "no" : "yes") as "yes" | "no", amountUsdc: num(b.amountUsdc), ref: str(b.ref) || null, rs: str(b.rs) || null, channel: "web" as const };
    // Practice mode: the wallet signed a free message (no transaction). Live: a real transaction signature.
    const r = SANDBOX // practice mode always needs the free signed message, never a raw signature
      ? await finishBuyPractice({ ...common, practiceMessage: str(b.practiceMessage), practiceSignature: str(b.practiceSignature) })
      : await finishBuy({ ...common, signature: str(b.signature) });
    if (r.recorded) after(() => runBotTicks({ settle: false }));
    return Response.json(r);
  } catch (e) { return errorResponse(e); }
}
