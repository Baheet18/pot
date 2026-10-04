import { marketActionGet, shareText, type ActionGetResponse } from "@pot/core";
import { ogImageFor } from "./links";
import { DEFAULT_MARKET_IMAGE, SANDBOX } from "./settings";
import { resolveRef } from "./flows";
import { signRef } from "./tokens";
import { getMarketView, type MarketView } from "./views";

/** Icon for Blinks: the market's own https image if it has one, else our rendered square card. */
export function actionIcon(v: MarketView) {
  const img = v.market.image;
  return img && img.startsWith("https://") && img !== DEFAULT_MARKET_IMAGE && !v.practice ? img : ogImageFor(v.market.id, true);
}

/** The Solana Action GET payload for a market (used by /api/actions/m/<id> and our /blink/<id> preview). */
export async function actionGetFor(id: string, refRaw: string | null, rsRaw: string | null): Promise<{ payload: ActionGetResponse; view: MarketView; ref: string }> {
  const v = await getMarketView(id);
  const { ref } = resolveRef(refRaw, rsRaw);
  const payload = marketActionGet({
    marketId: id, title: v.market.title, icon: actionIcon(v), verdictLine: `${v.verdict.kind}: ${v.verdict.line}`,
    yesPct: v.verdict.numbers.yesSplit, paysYes: v.payout.perYesShare, paysNo: v.payout.perNoShare,
    buyable: v.buyable, ref, rs: ref.startsWith("g") ? signRef(ref) : null, sandbox: SANDBOX,
  });
  return { payload, view: v, ref };
}

export const shareTextFor = (v: MarketView) =>
  shareText({ title: v.market.title, yesPct: v.verdict.numbers.yesSplit, verdict: v.verdict.kind, practice: v.practice || v.sandbox });
