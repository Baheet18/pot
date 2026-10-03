import type { MarketData } from "./types";

/**
 * Panta's creator royalty curve (panta.market/how-it-works): up to 20% of primary liquidity,
 * cut when the market tilts to one side. Panta measures tilt by unique traders; the API exposes
 * `currentSkewBps` (share-based) and `currentRoyaltyBps`, so we prefer the API's own number.
 */
export const ROYALTY_CURVE: Array<{ maxTilt: number; bps: number; label: string }> = [
  { maxTilt: 0.89, bps: 2000, label: "full 20%" },
  { maxTilt: 0.92, bps: 1000, label: "cut to 10%" },
  { maxTilt: 0.95, bps: 500, label: "cut to 5%" },
  { maxTilt: 1.01, bps: 0, label: "cut to 0%" },
];

export function royaltyBpsForTilt(tilt: number): number {
  for (const t of ROYALTY_CURVE) if (tilt <= t.maxTilt) return t.bps;
  return 0;
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
