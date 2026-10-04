import { buyable as buyableByTime, estimateCreatorRoyalty, estimatePayout, marketStats, normalizeMarket, type MarketData, type MarketStats, type PayoutEstimate, type RawTrade, type RoyaltyEstimate } from "@pot/core";
import { getMarketDetail, getMarketTrades, listAllMarkets, PantaError } from "./panta";
import { practiceDetail, practiceState } from "./practicemarket";
import { listPracticeMarkets } from "./store";
import { SANDBOX } from "./settings";

export interface MarketView {
  market: MarketData; stats: MarketStats; payout: PayoutEstimate; royalty: RoyaltyEstimate; buyable: boolean; sandbox: boolean; creator: string | null;
  /** Test mode: a group's own market stored by Pot (real question/rule/times, simulated pool). */
  practice: boolean;
  /** Group that created it (practice markets). */
  chatId: number | null;
  /** Raw trade tape (signature → shares), used for settlement receipts. */
  trades: RawTrade[];
}

function build(detail: Parameters<typeof normalizeMarket>[0], trades: Parameters<typeof normalizeMarket>[1], now: number, practice: boolean, chatId: number | null): MarketView {
  const market = normalizeMarket(detail, trades);
  // Panta's sandbox fixture dates are static, so treat its primary market as buyable; practice markets use their real times.
  const buyable = SANDBOX && !practice ? market.phase === "primary" : buyableByTime(market, now);
  return {
    market, stats: marketStats(market), payout: estimatePayout(market), royalty: estimateCreatorRoyalty(market),
    buyable, sandbox: SANDBOX, creator: (detail.creatorAddress as string | undefined) ?? null, practice, chatId, trades,
  };
}

export async function getMarketView(id: string): Promise<MarketView> {
  const now = Math.floor(Date.now() / 1000);
  if (SANDBOX) {
    const p = await practiceState(id);
    if (p) return build(practiceDetail(p.row, p.pool, now, p.result), p.pool.trades, now, true, p.row.chat_id);
    // Panta's sandbox answers every id with the same fixture; only show it for its own id, so an old or wrong
    // practice link says "not found" instead of pretending to be "Sandbox test market".
    if (!id.startsWith("TestMarket")) throw new PantaError(404, "NOT_FOUND", "This practice market doesn't exist (it may have been cleared).");
  }
  const [detail, trades] = await Promise.all([getMarketDetail(id), getMarketTrades(id)]);
  return build(detail, trades, now, false, null);
}

const OPEN = new Set(["primary", "open", "secondary", "secondary_active"]);
export async function listOpenViews(limit = 12): Promise<MarketView[]> {
  if (SANDBOX) {
    // Test mode lists the groups' practice markets, not Panta's single sandbox fixture.
    const rows = await listPracticeMarkets(limit * 2);
    const views = await Promise.all(rows.map((r) => getMarketView(r.id).catch(() => null)));
    return views.filter((v): v is MarketView => v !== null && !v.market.isResolved && v.market.endTime > Math.floor(Date.now() / 1000)).sort((a, b) => Number(b.buyable) - Number(a.buyable)).slice(0, limit);
  }
  const all = await listAllMarkets();
  const open = all.filter((m) => !m.resolved && OPEN.has(m.status ?? m.phase));
  const views = await Promise.all(open.slice(0, limit).map((m) => getMarketView(m.marketId).catch(() => null)));
  return views.filter((v): v is MarketView => v !== null).sort((a, b) => Number(b.buyable) - Number(a.buyable));
}
