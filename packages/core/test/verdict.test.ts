import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeMarket, summarizeTrades } from "../src/normalize";
import { computeVerdict, estimatePayout, estimateBuyPayout, moneySplit, organicVolume } from "../src/verdict";
import { VERDICT_CONFIG } from "../src/config";
import type { MarketData, RawDetail, RawTrade } from "../src/types";

function fixture(name: string) {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8")) as {
    detail: RawDetail;
    trades: RawTrade[];
  };
  return normalizeMarket(raw.detail, raw.trades);
}
const asOfPrimaryEnd = (m: MarketData) => m.primaryPhaseEndTime ?? m.endTime;

/** Synthetic market builder for rule edge cases. */
function synth(over: Omit<Partial<MarketData>, "trades"> & { trades?: Partial<MarketData["trades"]> } = {}): MarketData {
  const base: MarketData = {
    id: "synthetic",
    title: "Synthetic",
    category: "crypto",
    marketType: "standard",
    image: null,
    phase: "secondary",
    isGraduated: true,
    isResolved: false,
    isCancelled: false,
    yesWins: null,
    yesPrice: 0.6,
    noPrice: 0.4,
    lastYesPrice: 0.6,
    priceSource: "secondary_last_trade",
    valuationStatus: "indicative",
    volumeUsdc: 1000,
    totalVolumeUsdc: 1005,
    yesMoneyUsdc: 902.5,
    noMoneyUsdc: 102.5,
    yesShares: 1500,
    noShares: 200,
    primaryPoolUsdc: 804,
    totalTrades: 40,
    createdAt: 1_000_000,
    startTime: 1_000_000,
    primaryPhaseEndTime: 1_100_000,
    endTime: 2_000_000,
    resolutionTime: 2_000_000,
    resolvedAt: null,
    skewBps: 8800,
    royaltyBps: 2000,
    royaltyTier: "normal",
    resolutionRule: null,
    sources: [],
    trades: {
      rows: 40,
      complete: true,
      realWalletsYes: 15,
      realWalletsNo: 5,
      realWalletsDistinct: 20,
      seedingTrades: 0,
      seedingUsdcYes: 0,
      seedingUsdcNo: 0,
      realUsdcVisible: 1000,
      realUsdcYes: 900,
      realUsdcNo: 100,
      secondaryTrades: 6,
      topRealWalletShare: 0.2,
    },
    degraded: false,
  };
  return { ...base, ...over, trades: { ...base.trades, ...(over.trades ?? {}) } };
}
const DAY = 86_400;

describe("summarizeTrades", () => {
  it("excludes the seeding wallet from real wallet counts", () => {
    const S = VERDICT_CONFIG.seedingWallets[0];
    const trades: RawTrade[] = [
      { wallet: S, side: "yes", isPrimary: true, shares: "100", amountUsdc: null, signature: "a" },
      { wallet: S, side: "no", isPrimary: true, shares: "100", amountUsdc: null, signature: "b" },
      { wallet: "W1", side: "yes", isPrimary: true, shares: "10", amountUsdc: "5", signature: "c" },
      { wallet: "W1", side: "no", isPrimary: true, shares: "4", amountUsdc: "2", signature: "d" },
      { wallet: "W2", side: "no", isPrimary: false, shares: "3", amountUsdc: null, signature: "e" },
    ];
    const s = summarizeTrades(trades, { totalTrades: 5, lastYesPrice: 0.5 });
    expect(s.realWalletsYes).toBe(1);
    expect(s.realWalletsNo).toBe(2);
    expect(s.realWalletsDistinct).toBe(2);
    expect(s.seedingTrades).toBe(2);
    expect(s.seedingUsdcYes).toBeCloseTo(50);
    expect(s.secondaryTrades).toBe(1);
    expect(s.complete).toBe(true);
  });
});

describe("verdicts on real Panta markets (probe snapshot, Oct 3 2026)", () => {
  it("Haaland vs Bournemouth: Overconfident at primary close (and YES lost)", () => {
    const m = fixture("haaland");
    const v = computeVerdict(m, asOfPrimaryEnd(m));
    expect(v.kind).toBe("Overconfident");
    expect(v.numbers.leadingSide).toBe("YES");
    expect(v.numbers.leadingShare!).toBeGreaterThan(0.85);
    expect(v.numbers.realWallets).toBe(4);
    expect(m.yesWins).toBe(false);
  });

  it("treasury-only market (Milan Fashion Week) is Thin: zero real wallets, ~$0 organic", () => {
    const m = fixture("milan");
    expect(m.volumeUsdc).toBeGreaterThan(300);
    const v = computeVerdict(m, asOfPrimaryEnd(m));
    expect(v.kind).toBe("Thin");
    expect(v.numbers.realWallets).toBe(0);
    expect(organicVolume(m)).toBeLessThan(5);
  });

  it("BBNaija female winner: $245 headline volume but ~$23 real money → Thin", () => {
    const m = fixture("bbnaija");
    expect(m.volumeUsdc).toBeGreaterThan(240);
    const v = computeVerdict(m, 1791_000_000);
    expect(v.kind).toBe("Thin");
    expect(v.numbers.organicVolumeUsdc).toBeLessThan(30);
    expect(v.numbers.splitBasis).toBe("real-money");
    expect(v.numbers.leadingSide).toBe("YES");
  });

  it("empty and tiny markets are Thin", () => {
    for (const name of ["gta", "manutd_spurs", "france"]) {
      const m = fixture(name);
      expect(computeVerdict(m, 1791_000_000).kind, name).toBe("Thin");
    }
  });

  it("market with only seed money has no crowd split and says so", () => {
    const v = computeVerdict(fixture("gta"), 1791_000_000);
    expect(v.kind).toBe("Thin");
    expect(v.numbers.yesSplit).toBeNull();
    expect(v.line).toMatch(/No real wallets yet/);
  });

  it("Haaland YES buyers would have been paid less than they paid per share (pool math)", () => {
    const m = fixture("haaland");
    const p = estimatePayout(m);
    expect(p.basis).toBe("graduated-pool");
    expect(p.perYesShare!).toBeLessThan(m.lastYesPrice!);
    expect(p.perNoShare!).toBeGreaterThan(3);
  });

  it("flags incomplete trade history in data notes", () => {
    const m = fixture("cpi");
    expect(m.trades.complete).toBe(false);
    const v = computeVerdict(m, asOfPrimaryEnd(m));
    expect(v.dataNotes.join(" ")).toMatch(/2 of 13 trades/);
  });

  it("fixtures are full (non-degraded) detail rows", () => {
    for (const name of ["haaland", "bbnaija", "milan", "france"]) expect(fixture(name).degraded, name).toBe(false);
  });

  it("titles strip invisible characters", () => {
    expect(fixture("bbnaija").title.endsWith("?")).toBe(true);
  });
});

describe("rule edge cases (synthetic)", () => {
  it("Crowded: >80/20, enough wallets and money, open > 1 day, with order-book trades", () => {
    const m = synth({ trades: { realUsdcYes: 810, realUsdcNo: 190 } }); // 81/19 real split
    const v = computeVerdict(m, m.createdAt! + 3 * DAY);
    expect(v.kind).toBe("Crowded");
    expect(v.line).toMatch(/YES/);
  });

  it("Overconfident beats Crowded when split > 85/15 and the market is young", () => {
    const m = synth();
    expect(moneySplit(m).yesSplit!).toBeGreaterThan(0.85);
    const young = computeVerdict(m, m.createdAt! + 3600 * 5);
    expect(young.kind).toBe("Overconfident");
    expect(young.reasons.join(" ")).toMatch(/open 5h/);
  });

  it("Overconfident when the price was set only in the buy-only phase", () => {
    const m = synth({ trades: { secondaryTrades: 0 } });
    expect(computeVerdict(m, m.createdAt! + 5 * DAY).kind).toBe("Overconfident");
  });

  it("> 85/15 but mature, broad and traded after graduation → Crowded", () => {
    const m = synth();
    expect(computeVerdict(m, m.createdAt! + 5 * DAY).kind).toBe("Crowded");
  });

  it("80–85% lean without enough participation is Ordinary (no rule invented)", () => {
    const m = synth({ trades: { realUsdcYes: 830, realUsdcNo: 170, realWalletsDistinct: 6 } });
    const v = computeVerdict(m, m.createdAt! + 5 * DAY);
    expect(v.kind).toBe("Ordinary");
  });

  it("Thin wins over everything when real wallets are below the floor", () => {
    const m = synth({ trades: { realWalletsDistinct: 3 } });
    expect(computeVerdict(m, m.createdAt! + 5 * DAY).kind).toBe("Thin");
  });

  it("Thin when organic money is below $100 even with many wallets", () => {
    const m = synth({ volumeUsdc: 90 });
    expect(computeVerdict(m, m.createdAt! + 5 * DAY).kind).toBe("Thin");
  });

  it("thresholds come from config", () => {
    const m = synth({ trades: { realUsdcYes: 810, realUsdcNo: 190 } });
    const strict = { ...VERDICT_CONFIG, crowded: { ...VERDICT_CONFIG.crowded, minRealWallets: 50 } };
    expect(computeVerdict(m, m.createdAt! + 3 * DAY, strict).kind).toBe("Ordinary");
  });

  it("falls back to all-money split when the tape is incomplete", () => {
    const m = synth({ trades: { complete: false, rows: 10 } });
    expect(moneySplit(m).basis).toBe("all-money");
  });
});

describe("payout estimate", () => {
  it("uses the graduated winner pool when present", () => {
    const m = fixture("bbnaija");
    const p = estimatePayout(m);
    expect(p.basis).toBe("graduated-pool");
    expect(p.winnerPoolUsdc).toBeCloseTo(200.56, 1);
    expect(p.perYesShare!).toBeCloseTo(200.563692 / 262.764545, 3);
    expect(p.perNoShare!).toBeGreaterThan(p.perYesShare!);
  });

  it("uses volume × (1 − royalty) during the buy-only phase", () => {
    const m = fixture("france");
    const p = estimatePayout(m);
    expect(p.basis).toBe("volume-minus-royalty");
    expect(p.winnerPoolUsdc).toBeCloseTo(28.5 * 0.8, 2);
  });

  it("new-buy payout grows pool and shares", () => {
    const m = fixture("france");
    const r = estimateBuyPayout(m, "yes", 10, 19);
    expect(r!.perShare).toBeCloseTo(((28.5 + 10) * 0.8) / (m.yesShares + 19), 4);
  });
});
