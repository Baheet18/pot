import { after } from "next/server";
import { postMarketCard, safeErr } from "@pot/bot";
import { getBot } from "@/lib/telegram";
import { FlowError, finishCreate, finishCreatePractice, getDraft, SANDBOX, verify } from "@pot/server";
import { body, errorResponse, str } from "@/lib/http";
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const t = verify<{ d: string; u?: number }>(str(b.token));
    if (!t || t.d !== str(b.draftId)) throw new FlowError(401, "BAD_TOKEN", "This create link expired.");
    const d = await getDraft(t.d);
    if (!d || !t.u || Number(d.admin_id) !== Number(t.u)) throw new FlowError(403, "NOT_DRAFT_ADMIN", "This create link belongs to another admin.");
    const r = SANDBOX // practice mode always needs the free signed message, never a raw signature
      ? await finishCreatePractice(t.d, str(b.createId), str(b.wallet), str(b.practiceMessage), str(b.practiceSignature))
      : await finishCreate(t.d, str(b.createId), str(b.signature));
    after(async () => {
      const bot = await getBot();
      if (bot) await postMarketCard(bot, r.chatId, r.marketId, "🆕 <b>New market made by this group.</b> Tap a side to join the pot.").catch((e) => console.error("[pot] post card:", safeErr(e)));
    });
    return Response.json(r);
  } catch (e) { return errorResponse(e); }
}
