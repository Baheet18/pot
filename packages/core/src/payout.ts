import { MARKET_CONFIG, type MarketConfig } from "./config";
import { estimateCreatorRoyalty } from "./royalty";
import type { MarketData, MarketStats, PayoutEstimate } from "./types";

/**
 * YES share of the money. When the trade tape is complete, uses only real-wallet money
 * (creator seed and seeding wallet excluded); otherwise the on-chain YES/NO money totals.
 */
export function moneySplit(m: MarketData): number | null {
  if (m.trades.complete) {
    const y = m.trades.realUsdcYes, n = m.trades.realUsdcNo;
    return y + n > 0.5 ? y / (y + n) : null; // only seeds in the pool: no split to show
  }
  const total = m.yesMoneyUsdc + m.noMoneyUsdc;
  return total > 0 ? m.yesMoneyUsdc / total : null;
}

/** The few plain numbers cards and pages show: money split and how many real people bought. */
export function marketStats(m: MarketData): MarketStats {
  return { yesSplit: moneySplit(m), realWallets: m.trades.realWalletsDistinct, realWalletsYes: m.trades.realWalletsYes, realWalletsNo: m.trades.realWalletsNo };
}

/**
 * Parimutuel payout (panta.market/how-it-works): winner pool = all liquidity − creator royalty,
 * paid per winning share. Graduated markets report the finalized winner pool; otherwise we estimate
 * the royalty from Panta's number or the trader-tilt curve.
 */
export function estimatePayout(m: MarketData, cfg: MarketConfig = MARKET_CONFIG): PayoutEstimate {
  const royaltyBps = m.royaltyBps ?? estimateCreatorRoyalty(m).royaltyBps ?? cfg.payout.defaultRoyaltyBps;
  const graduatedPool = m.primaryPoolUsdc > 0;
  const winnerPoolUsdc = graduatedPool ? m.primaryPoolUsdc : m.totalVolumeUsdc * (1 - royaltyBps / 10_000);
  const perYesShare = m.yesShares > 0 ? winnerPoolUsdc / m.yesShares : null;
  const perNoShare = m.noShares > 0 ? winnerPoolUsdc / m.noShares : null;
  const yp = m.yesPrice !== null && m.yesPrice > 0 && m.yesPrice < 1 ? m.yesPrice : null;
  const np = m.noPrice !== null && m.noPrice > 0 && m.noPrice < 1 ? m.noPrice : null;
  return {
    winnerPoolUsdc,
    basis: graduatedPool ? "graduated-pool" : "volume-minus-royalty",
    royaltyBps,
    perYesShare,
    perNoShare,
    yesMultiple: perYesShare !== null && yp ? perYesShare / yp : null,
    noMultiple: perNoShare !== null && np ? perNoShare / np : null,
  };
}

/** Estimated payout for a new buy that adds `amountUsdc` and receives `shares` on `side` (primary phase only). */
export function estimateBuyPayout(m: MarketData, side: "yes" | "no", amountUsdc: number, shares: number, cfg: MarketConfig = MARKET_CONFIG) {
  const royaltyBps = m.royaltyBps ?? estimateCreatorRoyalty(m).royaltyBps ?? cfg.payout.defaultRoyaltyBps;
  const pool = (m.totalVolumeUsdc + amountUsdc) * (1 - royaltyBps / 10_000);
  const sideShares = (side === "yes" ? m.yesShares : m.noShares) + shares;
  if (sideShares <= 0) return null;
  const perShare = pool / sideShares;
  return { perShare, total: perShare * shares };
}
