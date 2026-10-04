import { MARKET_CONFIG } from "./config";
import type { MarketData, RawDetail, RawTrade, TradeSummary } from "./types";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** USDC / share base units (6 decimals) → human. */
const base6 = (v: unknown): number => (num(v) ?? 0) / 1e6;
/** On-chain prices are 1e9-scaled ("520520999" → 0.52). */
const price9 = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 1e9;
};

export function summarizeTrades(
  trades: RawTrade[],
  opts: { totalTrades: number; lastYesPrice: number | null; seedingWallets?: readonly string[] },
): TradeSummary {
  const seeding = new Set(opts.seedingWallets ?? MARKET_CONFIG.seedingWallets);
  const yesPx = opts.lastYesPrice ?? 0.5;
  const est = (t: RawTrade) => {
    const amt = num(t.amountUsdc);
    if (amt !== null) return amt;
    const sh = num(t.shares) ?? 0;
    return sh * (t.side === "yes" ? yesPx : 1 - yesPx);
  };
  const yes = new Set<string>();
  const no = new Set<string>();
  const usdcByWallet = new Map<string, number>();
  let realUsdcYes = 0;
  let realUsdcNo = 0;
  let seedingTrades = 0;
  let seedingUsdcYes = 0;
  let seedingUsdcNo = 0;
  let realUsdcVisible = 0;
  let secondaryTrades = 0;
  for (const t of trades) {
    if (t.isPrimary === false) secondaryTrades++;
    const side = t.side === "yes" ? "yes" : "no";
    if (seeding.has(t.wallet)) {
      seedingTrades++;
      if (side === "yes") seedingUsdcYes += est(t);
      else seedingUsdcNo += est(t);
      continue;
    }
    (side === "yes" ? yes : no).add(t.wallet);
    const usdc = est(t);
    realUsdcVisible += usdc;
    if (side === "yes") realUsdcYes += usdc;
    else realUsdcNo += usdc;
    usdcByWallet.set(t.wallet, (usdcByWallet.get(t.wallet) ?? 0) + usdc);
  }
  const topRealWalletShare =
    realUsdcVisible > 0 && usdcByWallet.size > 1 ? Math.max(...usdcByWallet.values()) / realUsdcVisible : null;
  return {
    rows: trades.length,
    complete: trades.length >= opts.totalTrades,
    realWalletsYes: yes.size,
    realWalletsNo: no.size,
    realWalletsDistinct: new Set([...yes, ...no]).size,
    seedingTrades,
    seedingUsdcYes,
    seedingUsdcNo,
    realUsdcVisible,
    realUsdcYes,
    realUsdcNo,
    secondaryTrades,
    topRealWalletShare,
  };
}

/** Panta returns unix seconds on live rows and ISO strings on sandbox rows; accept both. */
export function toUnix(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
}

export function normalizeMarket(d: RawDetail, trades: RawTrade[]): MarketData {
  const oc = d.onChain ?? {};
  const pick = <K extends keyof RawDetail & keyof typeof oc>(k: K) => (d[k] ?? oc[k]) as unknown;
  const totalTrades = num(pick("totalTrades")) ?? trades.length;
  const lastYesPrice = price9(pick("lastYesPrice")) ?? num(d.yesPrice);
  const title = (d.title || d.question || "").replace(/\u2060/g, "").trim();
  const createdAt = toUnix(d.createdAt ?? oc.createdAt);
  const primaryEnd = toUnix(d.primaryPhaseEndTime ?? oc.primaryPhaseEndTime);
  const resolvedAt = num(d.resolvedAt ?? oc.resolvedAt);
  const yesWinsRaw = (d.yesWins ?? oc.yesWins) as boolean | undefined;
  const isResolved = Boolean(d.isResolved ?? oc.isResolved ?? d.resolved);
  return {
    id: d.marketId,
    title: title || "(untitled market)",
    category: d.category,
    marketType: d.marketType,
    image: d.images?.[0] ?? null,
    phase: d.phase,
    isGraduated: Boolean(d.isGraduated ?? oc.isGraduated),
    isResolved,
    isCancelled: Boolean(d.isCancelled ?? oc.isCancelled),
    yesWins: isResolved ? Boolean(yesWinsRaw) : null,
    yesPrice: num(d.yesPrice),
    noPrice: num(d.noPrice),
    lastYesPrice,
    priceSource: d.priceSource ?? null,
    valuationStatus: d.valuationStatus ?? null,
    volumeUsdc: num(d.volumeUsdc) ?? 0,
    totalVolumeUsdc: num(d.totalVolumeUsdc) ?? base6(oc.totalVolume),
    yesMoneyUsdc: base6(pick("totalYesVolume")),
    noMoneyUsdc: base6(pick("totalNoVolume")),
    yesShares: base6(pick("totalYesShares")),
    noShares: base6(pick("totalNoShares")),
    primaryPoolUsdc: base6(pick("primaryPoolLamports")),
    totalTrades,
    createdAt,
    startTime: toUnix(d.startTime) ?? 0,
    primaryPhaseEndTime: primaryEnd,
    endTime: toUnix(d.endTime) ?? 0,
    resolutionTime: toUnix(d.resolutionTime) ?? 0,
    resolvedAt: resolvedAt || null,
    skewBps: num(pick("currentSkewBps")),
    royaltyBps: num(pick("currentRoyaltyBps")),
    royaltyTier: (pick("currentRoyaltyTier") as string | undefined) ?? null,
    resolutionRule: d.resolutionRule ?? null,
    sources: d.sources ?? (d.oracle ? d.oracle.split(",") : []),
    trades: summarizeTrades(trades, { totalTrades, lastYesPrice }),
    degraded: !d.onChain || !createdAt,
  };
}
