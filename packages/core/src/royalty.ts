import type { MarketData } from "./types";

/**
 * Panta's creator royalty curve, from panta.market/how-it-works ("The Creator Royalty Curve", checked 9 Oct 2026):
 *   tilt 50%–89% → 20% · 90%–92% → 10% · 93%–95% → 5% · 96%+ → 0%.
 * Tilt = share of unique traders on the bigger side (a trader on both sides counts for both), not money.
 * Panta lists whole percents; between them (e.g. 89.5%) we treat a band as starting at its listed number (90, 93, 96).
 * The API's own `currentRoyaltyBps` wins when present.
 */
export const ROYALTY_CURVE: Array<{ fromTiltPct: number; bps: number; label: string }> = [
  { fromTiltPct: 96, bps: 0, label: "cut to 0%" },
  { fromTiltPct: 93, bps: 500, label: "cut to 5%" },
  { fromTiltPct: 90, bps: 1000, label: "cut to 10%" },
  { fromTiltPct: 0, bps: 2000, label: "full 20%" },
];

export function royaltyBpsForTilt(tilt: number): number {
  const pct = Math.round(tilt * 100 * 1e6) / 1e6; // 9/10 → exactly 90, not 89.99999
  for (const t of ROYALTY_CURVE) if (pct >= t.fromTiltPct) return t.bps;
  return 2000;
}

export interface RoyaltyEstimate {
  poolUsdc: number;
  royaltyBps: number;
  estimatedUsdc: number;
  tilt: number | null;
  source: "panta" | "tilt-estimate";
  claimableNow: boolean;
  note: string;
}

export function estimateCreatorRoyalty(m: MarketData): RoyaltyEstimate {
  // Royalty is a share of total primary liquidity (YES + NO money, incl. the creator seed).
  const poolUsdc = m.totalVolumeUsdc > 0 ? m.totalVolumeUsdc : m.volumeUsdc;
  const realY = m.trades.realWalletsYes;
  const realN = m.trades.realWalletsNo;
  const tilt = realY + realN > 0 ? Math.max(realY, realN) / (realY + realN) : m.skewBps !== null ? m.skewBps / 10_000 : null;
  const fromPanta = m.royaltyBps !== null;
  const royaltyBps = fromPanta ? (m.royaltyBps as number) : tilt === null ? 2000 : royaltyBpsForTilt(tilt);
  const claimableNow = m.isGraduated || m.phase === "secondary" || m.phase === "resolved";
  return {
    poolUsdc,
    royaltyBps,
    estimatedUsdc: (poolUsdc * royaltyBps) / 10_000,
    tilt,
    source: fromPanta ? "panta" : "tilt-estimate",
    claimableNow,
    note: claimableNow ? "Claimable now (market has left the buy-only phase)." : "Claimable after the buy-only phase ends.",
  };
}
