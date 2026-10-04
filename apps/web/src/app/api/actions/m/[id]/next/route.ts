import { after } from "next/server";
import { runBotTicks } from "@/lib/telegram";
import { actionHeaders, completedAction, SOLANA_DEVNET, SOLANA_MAINNET } from "@pot/core";
import { actionIcon, DEFAULT_MARKET_IMAGE, finishBuy, finishBuyPractice, getMarketView, SANDBOX } from "@pot/server";
import { errorResponse, str } from "@/lib/http";

const H = () => actionHeaders(SANDBOX ? SOLANA_DEVNET : SOLANA_MAINNET);
export const OPTIONS = () => new Response(null, { headers: H() });

/** Action chaining callback. Live: {account, signature} of the broadcast tx. Practice: {account, signature, data} of the signed message. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const u = new URL(req.url);
    const b = (await req.json().catch(() => ({}))) as { account?: unknown; signature?: unknown; data?: unknown };
    const common = {
      orderId: u.searchParams.get("orderId") ?? "", quoteId: u.searchParams.get("quoteId") ?? undefined, wallet: str(b.account),
      marketId: id, side: (u.searchParams.get("side") === "no" ? "no" : "yes") as "yes" | "no", amountUsdc: Number(u.searchParams.get("amount")),
      ref: u.searchParams.get("ref"), rs: u.searchParams.get("rs"), channel: "blink" as const,
    };
    // Practice mode: the blink client sends back the signed message (`data`) and its signature.
    const r = SANDBOX
      ? await finishBuyPractice({ ...common, practiceMessage: str(b.data), practiceSignature: str(b.signature) })
      : await finishBuy({ ...common, signature: str(b.signature) });
    if (r.recorded) after(() => runBotTicks({ settle: false }));
    const v = await getMarketView(id).catch(() => null);
    const icon = v ? actionIcon(v) : DEFAULT_MARKET_IMAGE;
    const ok = r.status === "confirmed";
    return Response.json(completedAction(icon, ok ? "✅ You're in the pot" : "Order not confirmed", ok ? `Panta confirmed your buy.${r.newToPanta ? " Welcome to Panta!" : ""}${SANDBOX ? " Practice buy: no real money moved." : ""}` : `Panta status: ${r.status}`), { headers: H() });
  } catch (e) {
    const res = errorResponse(e, H());
    const j = (await res.json()) as { message: string };
    return Response.json({ message: j.message }, { status: res.status, headers: H() });
  }
}
