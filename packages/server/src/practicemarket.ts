import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { MARKET_CONFIG, type MarketDraft, type RawDetail, type RawTrade } from "@pot/core";
import { buysForWallets, getDraft, getPracticeMarket, getPracticeResult, insertPracticeResult, type PracticeResultRow, insertPracticeMarket, linkGroupMarket, listPracticeMarkets, practiceTrades, updateDraft, type PracticeMarketRow, type PracticeTradeRow } from "./store";
import { DEFAULT_MARKET_IMAGE, SANDBOX } from "./settings";

/**
 * Practice markets (PANTA_MODE=test only). When a group creates a market in test mode, the approved draft is
 * stored here with its own id, and its pool is simulated from practice buys recorded in our DB, so cards, pages,
 * Blinks and /mine show the group's real question, rule, sources and times. Nothing here touches Panta or any chain.
 *
 * Pool model (simple and transparent): the market opens with Panta-style seed money on both sides
 * (MARKET_CONFIG.creatorSeedUsdcPerSide each, from the seeding wallet). The YES price is YES money ÷ all money;
 * a buy of $A on a side gets A ÷ (that side's price just before the buy) shares, fixed when the buy is recorded.
 * Payouts split the pool after royalty.
 */
export const PRACTICE_SEED_WALLET = MARKET_CONFIG.seedingWallets[0];
const SEED = MARKET_CONFIG.creatorSeedUsdcPerSide;
const clamp = (p: number) => Math.min(0.98, Math.max(0.02, p));

export const newPracticeMarketId = () => bs58.encode(randomBytes(32));

export async function isPracticeMarket(id: string): Promise<boolean> {
  return SANDBOX && !!(await getPracticeMarket(id));
}

export interface PoolState { yesMoney: number; noMoney: number; yesShares: number; noShares: number; trades: RawTrade[]; sharesBySig: Map<string, number> }

/** Seed + recorded practice fills. */
export function replayPool(fills: Array<Pick<PracticeTradeRow, "signature" | "wallet" | "side" | "amount_usdc" | "shares" | "created_ms">>, createdAt: number): PoolState {
  const st: PoolState = { yesMoney: SEED, noMoney: SEED, yesShares: SEED / 0.5, noShares: SEED / 0.5, trades: [], sharesBySig: new Map() };
  st.trades.push(
    { wallet: PRACTICE_SEED_WALLET, side: "yes", isPrimary: true, shares: String(SEED / 0.5), amountUsdc: String(SEED), blockTime: createdAt, signature: "seed_yes" },
    { wallet: PRACTICE_SEED_WALLET, side: "no", isPrimary: true, shares: String(SEED / 0.5), amountUsdc: String(SEED), blockTime: createdAt, signature: "seed_no" },
  );
  for (const b of fills) {
    const amt = Number(b.amount_usdc), shares = Number(b.shares);
    if (b.side === "yes") { st.yesMoney += amt; st.yesShares += shares; } else { st.noMoney += amt; st.noShares += shares; }
    st.sharesBySig.set(b.signature, shares);
    st.trades.push({ wallet: b.wallet, side: b.side, isPrimary: true, shares: String(shares), amountUsdc: String(amt), blockTime: Math.floor(Number(b.created_ms) / 1000), signature: b.signature });
  }
  return st;
}

/** Quote for a new practice buy against the current pool. */
export function quotePractice(st: PoolState, side: "yes" | "no", amount: number) {
  const price = clamp((side === "yes" ? st.yesMoney : st.noMoney) / (st.yesMoney + st.noMoney));
  return { price, shares: amount / price };
}

/** A Panta-shaped detail row for a practice market, so the normal normalise/payout code works unchanged. */
export function practiceDetail(row: PracticeMarketRow, st: PoolState, now: number, result: PracticeResultRow | null = null): RawDetail {
  const d: MarketDraft = row.draft;
  const total = st.yesMoney + st.noMoney;
  const yesPrice = st.yesMoney / total;
  const phase = result ? "resolved" : now < d.startTime ? "primary" : "secondary";
  const res = result ? { resolved: true, isResolved: true, yesWins: result.outcome === "yes", resolvedAt: result.settled_at } : {};
  const b6 = (x: number) => String(Math.round(x * 1e6));
  return {
    marketId: row.id,
    title: d.question,
    question: d.question,
    description: d.description,
    category: d.category,
    phase,
    status: phase,
    marketType: d.marketType,
    startTime: d.startTime,
    endTime: d.endTime,
    resolutionTime: d.resolutionTime,
    primaryPhaseEndTime: d.startTime,
    resolved: !!result,
    ...res,
    volumeUsdc: total.toFixed(2),
    totalVolumeUsdc: total.toFixed(2),
    yesPrice: yesPrice.toFixed(4),
    noPrice: (1 - yesPrice).toFixed(4),
    images: [DEFAULT_MARKET_IMAGE],
    resolutionRule: d.resolutionRule,
    sources: d.sourcesOfTruth,
    createdAt: row.created_at,
    creatorAddress: row.creator_wallet,
    onChain: {
      createdAt: row.created_at,
      totalYesVolume: b6(st.yesMoney), totalNoVolume: b6(st.noMoney), totalVolume: b6(total),
      totalYesShares: b6(st.yesShares), totalNoShares: b6(st.noShares),
      totalTrades: String(st.trades.length), lastYesPrice: String(Math.round(yesPrice * 1e9)),
      primaryPhaseEndTime: d.startTime, isResolved: !!result, isCancelled: false, isGraduated: false,
      ...(result ? { yesWins: result.outcome === "yes", resolvedAt: result.settled_at } : {}),
    },
  };
}

export async function practiceState(id: string) {
  const row = await getPracticeMarket(id);
  if (!row) return null;
  const [trades, result] = await Promise.all([practiceTrades(id), getPracticeResult(id)]);
  return { row, pool: replayPool(trades, row.created_at), result };
}

/** Turns an approved, practice-signed draft into a practice market linked to its group. */
export async function createPracticeMarket(draftId: string, creatorWallet: string, signature: string) {
  if (!SANDBOX) throw new Error("Practice markets exist only in test mode.");
  const row = await getDraft(draftId);
  if (!row) throw new Error("Draft not found");
  const id = newPracticeMarketId();
  await insertPracticeMarket({ id, chatId: Number(row.chat_id), draftId, creatorWallet, draft: row.draft });
  await updateDraft(draftId, { status: "created", market_id: id, create_signature: signature });
  await linkGroupMarket(Number(row.chat_id), id, { createdByGroup: true, draftId, creatorWallet });
  return { marketId: id, chatId: Number(row.chat_id), sandbox: true, practice: true };
}

export { listPracticeMarkets };

/** Test-mode positions for /mine: practice buys grouped by market and side, with the market's title and status. */
export async function practicePositions(wallets: string[]) {
  const mine = await buysForWallets(wallets);
  const out: Array<{ marketId: string; title: string; side: "yes" | "no"; amountUsdc: number; shares: number; paysIfWin: number; closes: number; open: boolean; wallet: string; result: "yes" | "no" | null; payout: number }> = [];
  const now = Math.floor(Date.now() / 1000);
  for (const id of [...new Set(mine.map((b) => b.market_id))]) {
    const st = await practiceState(id);
    if (!st) continue;
    const { getMarketView } = await import("./views");
    const view = await getMarketView(id).catch(() => null);
    for (const side of ["yes", "no"] as const) {
      const rows = mine.filter((b) => b.market_id === id && b.side === side);
      if (!rows.length) continue;
      const shares = rows.reduce((a, b) => a + (st.pool.sharesBySig.get(b.signature) ?? 0), 0);
      const per = side === "yes" ? view?.payout.perYesShare : view?.payout.perNoShare;
      out.push({
        marketId: id, title: st.row.draft.question, side, wallet: rows[0].wallet,
        amountUsdc: rows.reduce((a, b) => a + Number(b.amount_usdc), 0),
        shares, paysIfWin: per ? shares * per : 0,
        closes: st.row.draft.startTime, open: !st.result && now < st.row.draft.startTime,
        result: st.result?.outcome ?? null, payout: st.result ? (st.result.outcome === side && per ? shares * per : 0) : 0,
      });
    }
  }
  return out;
}

/**
 * Practice mode only: the group's admin declares the result (there is no oracle for practice markets).
 * Idempotent: the first result wins; later calls return the stored one with `already: true`.
 */
export async function settlePracticeMarket(id: string, outcome: "yes" | "no", settledBy: number | null) {
  if (!SANDBOX) throw new Error("Only practice markets can be settled by hand.");
  const row = await getPracticeMarket(id);
  if (!row) throw new Error("That practice market doesn't exist.");
  const inserted = await insertPracticeResult(id, outcome, settledBy);
  const result = (await getPracticeResult(id))!;
  return { already: !inserted, outcome: result.outcome, chatId: row.chat_id };
}
