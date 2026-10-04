import { actionHeaders, parseAmount, SOLANA_DEVNET, SOLANA_MAINNET } from "@pot/core";
import { actionGetFor, FlowError, SANDBOX, startBuy } from "@pot/server";
import { errorResponse, str } from "@/lib/http";

const H = () => actionHeaders(SANDBOX ? SOLANA_DEVNET : SOLANA_MAINNET);
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const u = new URL(req.url);
    const { payload } = await actionGetFor(id, u.searchParams.get("ref"), u.searchParams.get("rs"));
    return Response.json(payload, { headers: H() });
  } catch (e) { return errorResponse(e, H()); }
}

export const OPTIONS = () => new Response(null, { headers: H() });

/** POST {account} → a transaction for the user's wallet to sign, chained to /next which confirms + records it. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const u = new URL(req.url);
    const b = (await req.json().catch(() => ({}))) as { account?: unknown };
    const account = str(b.account);
    const amount = parseAmount(u.searchParams.get("amount"));
    if (amount === null) throw new FlowError(400, "BAD_AMOUNT", "Enter between $1 and $500");
    const side = u.searchParams.get("side") === "no" ? "no" : "yes";
    const ref = u.searchParams.get("ref");
    const rs = u.searchParams.get("rs");
    const r = await startBuy({ marketId: id, side, amountUsdc: amount, wallet: account, ref, rs });
    const next = new URLSearchParams({ orderId: r.orderId, quoteId: r.quoteId, side, amount: String(r.amountUsdc), ref: ref ?? "web" });
    if (rs) next.set("rs", rs);
    const pays = r.paysAboutIfRight !== null ? ` Pays about $${r.paysAboutIfRight.toFixed(2)} if ${side.toUpperCase()} is right (estimate).` : "";
    if (SANDBOX) {
      // Practice mode: Solana Actions "message" response. The wallet signs free text; no transaction exists at all.
      return Response.json({
        type: "message",
        data: r.practiceMessage,
        links: { next: { type: "post", href: `/api/actions/m/${id}/next?${next}` } },
      }, { headers: H() });
    }
    return Response.json({
      type: "transaction",
      transaction: r.transaction,
      message: `Buying ${side.toUpperCase()} for $${r.amountUsdc.toFixed(2)} ≈ ${r.shares.toFixed(2)} shares.${pays}`,
      links: { next: { type: "post", href: `/api/actions/m/${id}/next?${next}` } },
    }, { headers: H() });
  } catch (e) {
    // Actions spec: errors as {message} so the blink client can show them.
    const res = errorResponse(e, H());
    const j = (await res.json()) as { message: string };
    return Response.json({ message: j.message }, { status: res.status, headers: H() });
  }
}
