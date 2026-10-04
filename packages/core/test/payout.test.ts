import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeMarket, summarizeTrades } from "../src/normalize";
import { estimateBuyPayout, estimatePayout, marketStats, moneySplit } from "../src/payout";
import { MARKET_CONFIG } from "../src/config";
import type { RawDetail, RawTrade } from "../src/types";

function fixture(name: string) {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8")) as { detail: RawDetail; trades: RawTrade[] };
  return normalizeMarket(raw.detail, raw.trades);
}

describe("summarizeTrades", () => {
  it("excludes the seeding wallet from real wallet counts", () => {
    const S = MARKET_CONFIG.seedingWallets[0];
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

describe("plain market numbers on real Panta markets (probe snapshot, Oct 3 2026)", () => {
  it("counts real people and the real-money split (seeding wallet excluded)", () => {
    const h = marketStats(fixture("haaland"));
    expect(h.realWallets).toBe(4);
    expect(h.yesSplit!).toBeGreaterThan(0.85);
    expect(marketStats(fixture("milan")).realWallets).toBe(0);
  });
  it("a market with only seed money shows no split", () => {
    expect(moneySplit(fixture("gta"))).toBeNull();
  });
  it("falls back to the all-money split when the trade history is incomplete", () => {
    const m = fixture("cpi");
    expect(m.trades.complete).toBe(false);
    expect(moneySplit(m)).toBeCloseTo(m.yesMoneyUsdc / (m.yesMoneyUsdc + m.noMoneyUsdc), 6);
  });
  it("fixtures are full (non-degraded) detail rows and titles strip invisible characters", () => {
    for (const name of ["haaland", "bbnaija", "milan", "france"]) expect(fixture(name).degraded, name).toBe(false);
    expect(fixture("bbnaija").title.endsWith("?")).toBe(true);
  });
});

describe("payout estimate (Panta pari-passu: winner pool = liquidity − creator royalty)", () => {
  it("uses the graduated winner pool when present", () => {
    const m = fixture("bbnaija");
    const p = estimatePayout(m);
    expect(p.basis).toBe("graduated-pool");
    expect(p.winnerPoolUsdc).toBeCloseTo(200.56, 1);
    expect(p.perYesShare!).toBeCloseTo(200.563692 / 262.764545, 3);
    expect(p.perNoShare!).toBeGreaterThan(p.perYesShare!);
  });
  it("Haaland YES buyers were paid less per share than they paid (pool math)", () => {
    const m = fixture("haaland");
    const p = estimatePayout(m);
    expect(p.perYesShare!).toBeLessThan(m.lastYesPrice!);
    expect(m.yesWins).toBe(false);
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
  it("royalty follows the trader-tilt curve when Panta doesn't report it (90%+ one side cuts it)", () => {
    const m = fixture("france");
    const tilted = { ...m, royaltyBps: null, trades: { ...m.trades, realWalletsYes: 9, realWalletsNo: 1 } };
    expect(estimatePayout(tilted).royaltyBps).toBe(1000);
  });
});
