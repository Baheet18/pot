/**
 * All verdict thresholds live here. Change numbers in one place; the engine,
 * the UI "How the verdicts work" section and the tests all read from this object.
 */
export interface VerdictConfig {
  seedingWallets: readonly string[];
  creatorSeedUsdcPerSide: number;
  thin: { minRealWallets: number; minOrganicVolumeUsdc: number };
  crowded: { split: number; minRealWallets: number; minOrganicVolumeUsdc: number; minAgeHours: number };
  overconfident: { split: number; youngHours: number; moderateRealWallets: number; moderateOrganicVolumeUsdc: number };
  payout: { defaultRoyaltyBps: number };
}

export const VERDICT_CONFIG: VerdictConfig = {
  /** Wallets that seed both sides of most markets (Panta treasury / liquidity seeding, inferred from trade tapes). */
  seedingWallets: ["Bji2jpKEYAphqJv9q3J8cXJPcnWLtamWD21zLSqHkE2z"],
  /** Each market starts with a creator seed split evenly across YES/NO (USDC). */
  creatorSeedUsdcPerSide: 2.5,
  thin: {
    /** Fewer distinct real (non-seeding) wallets than this → Thin. */
    minRealWallets: 4,
    /** Less organic (non-seeding) money than this → Thin. */
    minOrganicVolumeUsdc: 100,
  },
  crowded: {
    /** Leading side's share of the money must exceed this (0.80 = 80/20). */
    split: 0.8,
    minRealWallets: 8,
    minOrganicVolumeUsdc: 300,
    /** Market must have been open longer than this. */
    minAgeHours: 24,
  },
  overconfident: {
    split: 0.85,
    /** "Young" = open for less than this. */
    youngHours: 24,
    /** "Moderate participation" = below either of these. */
    moderateRealWallets: 8,
    moderateOrganicVolumeUsdc: 300,
  },
  payout: {
    /** Used only if the market does not report its own royalty. */
    defaultRoyaltyBps: 2000,
  },
};
