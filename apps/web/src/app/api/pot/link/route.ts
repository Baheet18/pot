import { rerenderReceipts } from "@pot/bot";
import { buysForWallets, verifyAndLink } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
import { getBot } from "@/lib/telegram";

export async function POST(req: Request) {
  try {
    const b = await body(req);
    const out = await verifyAndLink(str(b.token), str(b.wallet), str(b.signature));
    // The wallet now has a Telegram name: refresh any receipts that showed it as an address.
    try {
      const bot = await getBot();
      const ids = [...new Set((await buysForWallets([str(b.wallet)])).map((x) => x.market_id))].slice(0, 10);
      if (bot) for (const id of ids) await rerenderReceipts(bot.api, id).catch(() => 0);
    } catch { /* best effort */ }
    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
