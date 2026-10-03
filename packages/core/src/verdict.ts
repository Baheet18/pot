import { VERDICT_CONFIG, type VerdictConfig } from "./config";
import type { MarketData, PayoutEstimate, Verdict, VerdictNumbers } from "./types";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`;
const hrs = (h: number) => (h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)} days`);

/**
 * Organic money = reported volume minus what the seeding wallet(s) put in.
 * When the trade tape is incomplete, missing rows are counted as organic, so this is an upper bound.
 */
export function organicVolume(m: MarketData): number {
  return Math.max(0, m.volumeUsdc - m.trades.seedingUsdcYes - m.trades.seedingUsdcNo);
}

/**
 * YES share of the money. When the trade tape is complete, uses only real-wallet money
 * (creator seed and seeding wallet excluded); otherwise the on-chain YES/NO money totals.
 */
export function moneySplit(m: MarketData, _cfg: VerdictConfig = VERDICT_CONFIG) {
  if (m.trades.complete) {
    const y = m.trades.realUsdcYes;
    const n = m.trades.realUsdcNo;
    if (y + n > 0.5) return { yesSplit: y / (y + n), basis: "real-money" as const };
    // Complete history with no real money: only seeds are in the pool, so there is no crowd split.
    return { yesSplit: null, basis: "none" as const };
  }
  const total = m.yesMoneyUsdc + m.noMoneyUsdc;
  if (total <= 0) return { yesSplit: null, basis: "none" as const };
  return { yesSplit: m.yesMoneyUsdc / total, basis: "all-money" as const };
}

/**
 * Verdict at time `asOf` (unix seconds). For resolved markets pass the primary-phase end
 * to read the market as it looked when buy-only trading closed.
 */
export function computeVerdict(m: MarketData, asOf: number, cfg: VerdictConfig = VERDICT_CONFIG): Verdict {
  const real = m.trades.realWalletsDistinct;
  const organic = organicVolume(m);
  const { yesSplit, basis } = moneySplit(m, cfg);
  const leadingSide = yesSplit === null ? null : yesSplit >= 0.5 ? "YES" : "NO";
  const leadingShare = yesSplit === null ? null : Math.max(yesSplit, 1 - yesSplit);
  const ageHours = m.createdAt ? Math.max(0, (asOf - m.createdAt) / 3600) : null;
  const priceBuyOnly = m.phase === "primary" || m.trades.secondaryTrades === 0;
  const yesPrice = m.isResolved ? m.lastYesPrice : m.yesPrice;

  const numbers: VerdictNumbers = {
    realWallets: real,
    realWalletsYes: m.trades.realWalletsYes,
    realWalletsNo: m.trades.realWalletsNo,
    organicVolumeUsdc: organic,
    yesSplit,
    splitBasis: basis,
    leadingSide,
    leadingShare,
    ageHours,
    priceBuyOnly,
    yesPrice,
    tapeComplete: m.trades.complete,
    tapeRows: m.trades.rows,
    totalTrades: m.totalTrades,
  };

  const dataNotes: string[] = [];
  if (m.degraded) dataNotes.push("Panta's on-chain detail for this market was unavailable on the last refresh; some numbers may be missing.");
  if (!m.trades.complete) {
    dataNotes.push(
      `Trade history shows ${m.trades.rows} of ${m.totalTrades} trades, so the wallet count is a minimum and organic money is an upper bound.`,
    );
  }
  if (basis === "all-money") dataNotes.push("Money split includes seeding money (real-only split needs a complete trade history).");
  if (m.trades.seedingTrades > 0) {
    dataNotes.push(`${m.trades.seedingTrades} trades came from Panta's seeding wallet and are excluded.`);
  }
  if (m.trades.topRealWalletShare !== null && m.trades.topRealWalletShare >= 0.6) {
    dataNotes.push(`One wallet put in ${pct(m.trades.topRealWalletShare)} of the real money.`);
  }

  const T = cfg.thin;
  const thinWallets = real < T.minRealWallets;
  const thinMoney = organic < T.minOrganicVolumeUsdc;
  if (thinWallets || thinMoney) {
    const reasons: string[] = [];
    if (thinWallets) reasons.push(`real wallets ${real} < ${T.minRealWallets}`);
    if (thinMoney) reasons.push(`organic money ${usd(organic)} < ${usd(T.minOrganicVolumeUsdc)}`);
    const walletsTxt = `${real} real wallet${real === 1 ? "" : "s"}`;
    const line =
      real === 0
        ? "No real wallets yet. Only Panta's seed money is in this market, so the price is a placeholder."
        : thinWallets && thinMoney
          ? `Only ${walletsTxt} and about ${usd(organic)} of real money so far; this price isn't saying much yet.`
          : thinWallets
            ? `Only ${walletsTxt} so far (about ${usd(organic)} of real money); too few people to call it a crowd.`
            : `${walletsTxt} but only about ${usd(organic)} of real money; too little at stake to trust the price yet.`;
    return {
      kind: "Thin",
      line,
      reasons,
      numbers,
      dataNotes,
    };
  }

  if (leadingShare !== null && leadingSide) {
    const O = cfg.overconfident;
    if (leadingShare > O.split) {
      const young = ageHours !== null && ageHours < O.youngHours;
      const moderate = real < O.moderateRealWallets || organic < O.moderateOrganicVolumeUsdc;
      if (young || moderate || priceBuyOnly) {
        const reasons = [`${pct(leadingShare)} of money on ${leadingSide} > ${pct(O.split)}`];
        const why: string[] = [];
        if (young) {
          reasons.push(`open ${hrs(ageHours!)} < ${O.youngHours}h`);
          why.push(`only ${hrs(ageHours!)} old`);
        }
        if (moderate) {
          reasons.push(`participation moderate (${real} wallets, ${usd(organic)})`);
          why.push(`backed by just ${real} wallets and ${usd(organic)}`);
        }
        if (priceBuyOnly) {
          reasons.push("price set only in the buy-only phase");
          why.push("no one has been able to sell into it yet");
        }
        return {
          kind: "Overconfident",
          line: `${pct(leadingShare)} of the money is on ${leadingSide}, but the market is ${why.join(" and ")}.`,
          reasons,
          numbers,
          dataNotes,
        };
      }
    }
    const C = cfg.crowded;
    const ageOk = ageHours !== null && ageHours > C.minAgeHours;
    if (leadingShare > C.split && real >= C.minRealWallets && organic >= C.minOrganicVolumeUsdc && ageOk) {
      return {
        kind: "Crowded",
        line: `${pct(leadingShare)} of the money from ${real} wallets is on ${leadingSide}; the other side is cheap for a reason, or it is a crowded trade.`,
        reasons: [
          `${pct(leadingShare)} on ${leadingSide} > ${pct(C.split)}`,
          `${real} wallets ≥ ${C.minRealWallets}`,
          `${usd(organic)} ≥ ${usd(C.minOrganicVolumeUsdc)}`,
          `open ${hrs(ageHours!)} > ${C.minAgeHours}h`,
        ],
        numbers,
        dataNotes,
      };
    }
  }

  const splitTxt = leadingShare !== null && leadingSide ? `${pct(leadingShare)} ${leadingSide}` : "no clear lean";
  return {
    kind: "Ordinary",
    line: `${real} real wallets, about ${usd(organic)} of real money and a ${splitTxt} split; no warning sign fired.`,
    reasons: ["no Thin, Overconfident or Crowded rule fired"],
    numbers,
    dataNotes,
  };
}

/**
 * Parimutuel payout estimate: winners split the pool (after creator royalty) per share.
 * Graduated markets report the finalized winner pool; otherwise volume × (1 − royalty).
 */
export function estimatePayout(m: MarketData, cfg: VerdictConfig = VERDICT_CONFIG): PayoutEstimate {
  const royaltyBps = m.royaltyBps ?? cfg.payout.defaultRoyaltyBps;
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
export function estimateBuyPayout(m: MarketData, side: "yes" | "no", amountUsdc: number, shares: number, cfg: VerdictConfig = VERDICT_CONFIG) {
  const royaltyBps = m.royaltyBps ?? cfg.payout.defaultRoyaltyBps;
  const pool = (m.totalVolumeUsdc + amountUsdc) * (1 - royaltyBps / 10_000);
  const sideShares = (side === "yes" ? m.yesShares : m.noShares) + shares;
  if (sideShares <= 0) return null;
  const perShare = pool / sideShares;
  return { perShare, total: perShare * shares };
}
