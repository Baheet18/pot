import { after } from "next/server";
import { postMarketCard } from "@pot/bot";
import { getBot } from "@/lib/telegram";
import { FlowError, finishCreate, verify } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const t = verify<{ d: string }>(str(b.token));
    if (!t || t.d !== str(b.draftId)) throw new FlowError(401, "BAD_TOKEN", "This create link expired.");
    const r = await finishCreate(t.d, str(b.createId), str(b.signature));
    after(async () => {
      const bot = await getBot();
      if (bot) await postMarketCard(bot, r.chatId, r.marketId, "🆕 <b>New market made by this group.</b> Tap a side to join the pot.").catch((e) => console.error("[pot] post card:", (e as Error).message));
    });
    return Response.json(r);
  } catch (e) { return errorResponse(e); }
}
