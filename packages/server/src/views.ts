import { buyable as buyableByTime, computeVerdict, estimateCreatorRoyalty, estimatePayout, normalizeMarket, type MarketData, type PayoutEstimate, type RoyaltyEstimate, type Verdict } from "@pot/core";
import { getMarketDetail, getMarketTrades, listAllMarkets } from "./panta";
import { SANDBOX } from "./settings";

export interface MarketView { market: MarketData; verdict: Verdict; payout: PayoutEstimate; royalty: RoyaltyEstimate; buyable: boolean; sandbox: boolean; creator: string | null }

export async function getMarketView(id: string): Promise<MarketView> {
  const [detail, trades] = await Promise.all([getMarketDetail(id), getMarketTrades(id)]);
  const market = normalizeMarket(detail, trades);
  const now = Math.floor(Date.now() / 1000);
  // Sandbox fixture dates are static; treat its primary market as buyable.
  const buyable = SANDBOX ? market.phase === "primary" : buyableByTime(market, now);
  return {
    market,
    verdict: computeVerdict(market, now),
    payout: estimatePayout(market),
    royalty: estimateCreatorRoyalty(market),
    buyable,
    sandbox: SANDBOX,
    creator: (detail.creatorAddress as string | undefined) ?? null,
  };
}

const OPEN = new Set(["primary", "open", "secondary", "secondary_active"]);
export async function listOpenViews(limit = 12): Promise<MarketView[]> {
  const all = await listAllMarkets();
  const open = all.filter((m) => !m.resolved && OPEN.has(m.status ?? m.phase));
  const views = await Promise.all(open.slice(0, limit).map((m) => getMarketView(m.marketId).catch(() => null)));
  return views.filter((v): v is MarketView => v !== null).sort((a, b) => Number(b.buyable) - Number(a.buyable));
}
