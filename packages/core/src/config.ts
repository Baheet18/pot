/** Market constants used when reading Panta data (seeding wallet, creator seed, default royalty). */
export interface MarketConfig {
  seedingWallets: readonly string[];
  creatorSeedUsdcPerSide: number;
  payout: { defaultRoyaltyBps: number };
}

export const MARKET_CONFIG: MarketConfig = {
  /** Wallets that seed both sides of most markets (Panta treasury / liquidity seeding, inferred from trade tapes). */
  seedingWallets: ["Bji2jpKEYAphqJv9q3J8cXJPcnWLtamWD21zLSqHkE2z"],
  /** Each market starts with a creator seed split evenly across YES/NO (USDC). */
  creatorSeedUsdcPerSide: 2.5,
  payout: {
    /** Used only if neither the market's royalty nor its trader tilt is known. */
    defaultRoyaltyBps: 2000,
  },
};

/** Panta's primary-market trading fee, charged to the buyer on top of the stake (panta.market/how-it-works). */
export const PANTA_PRIMARY_FEE_RATE = 0.02;
