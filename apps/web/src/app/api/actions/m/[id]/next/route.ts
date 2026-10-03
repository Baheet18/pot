import { actionHeaders, completedAction, SOLANA_DEVNET, SOLANA_MAINNET } from "@pot/core";
import { DEFAULT_MARKET_IMAGE, finishBuy, getMarketView, SANDBOX } from "@pot/server";
import { errorResponse, str } from "@/lib/http";

const H = () => actionHeaders(SANDBOX ? SOLANA_DEVNET : SOLANA_MAINNET);
export const OPTIONS = () => new Response(null, { headers: H() });

/** Action chaining callback: POST {account, signature} after the wallet broadcast the transaction. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const u = new URL(req.url);
    const b = (await req.json().catch(() => ({}))) as { account?: unknown; signature?: unknown };
    const r = await finishBuy({
      orderId: u.searchParams.get("orderId") ?? "", quoteId: u.searchParams.get("quoteId") ?? undefined, signature: str(b.signature), wallet: str(b.account),
      marketId: id, side: u.searchParams.get("side") === "no" ? "no" : "yes", amountUsdc: Number(u.searchParams.get("amount")),
      ref: u.searchParams.get("ref"), rs: u.searchParams.get("rs"), channel: "blink",
    });
    const v = await getMarketView(id).catch(() => null);
    const icon = v?.market.image?.startsWith("https://") ? v.market.image : DEFAULT_MARKET_IMAGE;
    const ok = r.status === "confirmed";
    return Response.json(completedAction(icon, ok ? "✅ You're in the pot" : "Order not confirmed", ok ? `Panta confirmed your buy.${r.newToPanta ? " Welcome to Panta!" : ""}${SANDBOX ? " (sandbox)" : ""}` : `Panta status: ${r.status}`), { headers: H() });
  } catch (e) {
    const res = errorResponse(e, H());
    const j = (await res.json()) as { message: string };
    return Response.json({ message: j.message }, { status: res.status, headers: H() });
  }
}
