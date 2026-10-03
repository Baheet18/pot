/** Raw shapes returned by the Panta API (only the fields we read). */
export interface RawListItem {
  marketId: string;
  title: string;
  category: string;
  phase: string;
  status: string;
  marketType: string;
  startTime: number | string;
  endTime: number | string;
  resolutionTime: number | string;
  resolved: boolean;
  volumeUsdc: string;
  yesPrice: string | null;
  noPrice: string | null;
  images?: string[];
}

export interface RawOnChain {
  createdAt?: number;
  totalYesShares?: string;
  totalNoShares?: string;
  totalYesVolume?: string;
  totalNoVolume?: string;
  totalVolume?: string;
  totalTrades?: string;
  lastYesPrice?: string;
  primaryPoolLamports?: string;
  primaryPhaseEndTime?: number;
  currentSkewBps?: string;
  currentRoyaltyBps?: string;
  currentRoyaltyTier?: string;
  isGraduated?: boolean;
  isResolved?: boolean;
  isCancelled?: boolean;
  yesWins?: boolean;
  resolvedAt?: number;
}

export interface RawDetail extends RawListItem {
  question?: string;
  description?: string;
  priceSource?: string;
  valuationStatus?: string;
  totalVolumeUsdc?: string;
  createdAt?: number | string;
  primaryPhaseEndTime?: number | string;
  isGraduated?: boolean;
  isResolved?: boolean;
  isCancelled?: boolean;
  yesWins?: boolean;
  resolvedAt?: number;
  currentSkewBps?: string;
  currentRoyaltyBps?: string;
  currentRoyaltyTier?: string;
  resolutionRule?: string;
  sources?: string[];
  oracle?: string;
  totalYesVolume?: string;
  totalNoVolume?: string;
  totalYesShares?: string;
  totalNoShares?: string;
  totalTrades?: string;
  primaryPoolLamports?: string;
  lastYesPrice?: string;
  onChain?: RawOnChain | null;
  creatorAddress?: string;
  disclaimer?: string;
}

export interface RawTrade {
  wallet: string;
  side: "yes" | "no" | string;
  kind?: string;
  isPrimary: boolean;
  shares?: string | null;
  amountUsdc?: string | null;
  blockTime?: number | null;
  signature: string;
}

/** Normalized market used by the verdict engine and UI. All money in USDC (human units). */
export interface MarketData {
  id: string;
  title: string;
  category: string;
  marketType: string;
  image: string | null;
  phase: "primary" | "secondary" | "resolved" | "cancelled" | string;
  isGraduated: boolean;
  isResolved: boolean;
  isCancelled: boolean;
  yesWins: boolean | null;

  yesPrice: number | null;
  noPrice: number | null;
  /** Last curve/trade YES price even after resolution (resolved yesPrice is 0/1). */
  lastYesPrice: number | null;
  priceSource: string | null;
  valuationStatus: string | null;

  volumeUsdc: number;
  totalVolumeUsdc: number;
  yesMoneyUsdc: number;
  noMoneyUsdc: number;
  yesShares: number;
  noShares: number;
  primaryPoolUsdc: number;
  totalTrades: number;

  createdAt: number | null;
  startTime: number;
  primaryPhaseEndTime: number | null;
  endTime: number;
  resolutionTime: number;
  resolvedAt: number | null;

  skewBps: number | null;
  royaltyBps: number | null;
  royaltyTier: string | null;
  resolutionRule: string | null;
  sources: string[];

  trades: TradeSummary;
  /** True when Panta returned the detail row without its on-chain block (RPC hiccup). */
  degraded: boolean;
}

export interface TradeSummary {
  /** Rows visible in the trade tape. */
  rows: number;
  /** True when tape rows >= totalTrades reported on-chain. */
  complete: boolean;
  realWalletsYes: number;
  realWalletsNo: number;
  realWalletsDistinct: number;
  seedingTrades: number;
  /** Estimated USDC put in by seeding wallets (amountUsdc when present, else shares × side price). */
  seedingUsdcYes: number;
  seedingUsdcNo: number;
  /** Estimated USDC from real wallets in visible rows. */
  realUsdcVisible: number;
  realUsdcYes: number;
  realUsdcNo: number;
  /** Rows with isPrimary === false (order-book trades after graduation). */
  secondaryTrades: number;
  /** Largest single real wallet's share of all visible real-wallet money (0..1); null if < 2 wallets. */
  topRealWalletShare: number | null;
}

export type VerdictKind = "Thin" | "Crowded" | "Overconfident" | "Ordinary";

export interface VerdictNumbers {
  realWallets: number;
  realWalletsYes: number;
  realWalletsNo: number;
  organicVolumeUsdc: number;
  /** YES share of the money used for the split (0..1). */
  yesSplit: number | null;
  splitBasis: "real-money" | "all-money" | "none";
  leadingSide: "YES" | "NO" | null;
  leadingShare: number | null;
  ageHours: number | null;
  priceBuyOnly: boolean;
  yesPrice: number | null;
  tapeComplete: boolean;
  tapeRows: number;
  totalTrades: number;
}

export interface Verdict {
  kind: VerdictKind;
  line: string;
  /** Which rule(s) fired, for transparency. */
  reasons: string[];
  numbers: VerdictNumbers;
  dataNotes: string[];
}

export interface PayoutEstimate {
  winnerPoolUsdc: number;
  basis: "graduated-pool" | "volume-minus-royalty";
  royaltyBps: number;
  perYesShare: number | null;
  perNoShare: number | null;
  /** payout per share ÷ current price, i.e. money multiple if right. */
  yesMultiple: number | null;
  noMultiple: number | null;
}
