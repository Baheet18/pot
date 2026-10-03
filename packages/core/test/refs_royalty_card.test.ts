import { describe, expect, it } from "vitest";
import { formatRef, parseRef, pantaUserId, refGroup, cleanHandle } from "../src/refs";
import { royaltyBpsForTilt, estimateCreatorRoyalty } from "../src/royalty";
import { renderCard, splitBar, buyable } from "../src/card";
import { marketActionGet, parseAmount, blinkUrl, actionHeaders, SOLANA_MAINNET } from "../src/actions";
import { normalizeMarket } from "../src/normalize";
import { computeVerdict, estimatePayout } from "../src/verdict";
import type { RawDetail } from "../src/types";

describe("refs", () => {
  it("round-trips group, member, x and web refs", () => {
    for (const s of ["g-1001234567890", "g-1001234567890u42", "xBaheet_", "web"]) expect(formatRef(parseRef(s)!)).toBe(s);
    expect(parseRef("g-1u")).toBeNull();
    expect(parseRef("x@bad")).toBeNull();
    expect(parseRef("../etc")).toBeNull();
  });
  it("maps refs to Panta userIds and groups", () => {
    expect(pantaUserId(parseRef("g-100123u7"))).toBe("pot:g-100123u7");
    expect(pantaUserId(null)).toBe("pot:web");
    expect(refGroup(parseRef("g-100123u7"))).toBe(-100123);
    expect(refGroup(parseRef("xfoo"))).toBeNull();
    expect(cleanHandle("@Baheet_")).toBe("Baheet_");
    expect(cleanHandle("no spaces")).toBeNull();
  });
});

describe("royalty", () => {
  it("follows Panta's tilt curve", () => {
    expect(royaltyBpsForTilt(0.5)).toBe(2000);
    expect(royaltyBpsForTilt(0.89)).toBe(2000);
    expect(royaltyBpsForTilt(0.91)).toBe(1000);
    expect(royaltyBpsForTilt(0.94)).toBe(500);
    expect(royaltyBpsForTilt(0.97)).toBe(0);
  });
});

// Sandbox fixture as returned by Panta for pk_test keys (ISO times, no onChain block).
const sandboxDetail = {
  marketId: "TestMarket1111111111111111111111111111111", category: "crypto", title: "Sandbox test market", phase: "primary",
  marketType: "standard", startTime: "2026-01-01T00:00:00Z", endTime: "2026-12-31T23:59:59Z", resolutionTime: "2027-01-01T00:00:00Z",
  resolved: false, status: "primary", volumeUsdc: "0.00", yesPrice: "0.50", noPrice: "0.50", images: [], onChain: null,
} as unknown as RawDetail;

describe("sandbox normalisation + card", () => {
  const m = normalizeMarket(sandboxDetail, []);
  const now = Math.floor(Date.parse("2026-10-03T17:30:00+01:00") / 1000);
  it("parses ISO times and flags missing on-chain data", () => {
    expect(m.endTime).toBe(Math.floor(Date.parse("2026-12-31T23:59:59Z") / 1000));
    expect(m.degraded).toBe(true);
    expect(m.yesPrice).toBe(0.5);
  });
  it("renders a Thin card with sandbox label, Powered by Panta and buy buttons only while buyable", () => {
    const v = computeVerdict(m, now);
    const p = estimatePayout(m);
    expect(v.kind).toBe("Thin");
    // Sandbox market's startTime is in the past, so it is not buyable by time.
    expect(buyable(m, now)).toBe(false);
    const open = { ...m, startTime: now + 3600, primaryPhaseEndTime: now + 3600 };
    const card = renderCard(open, v, p, { buyYes: "https://x/y", buyNo: "https://x/n", details: "https://x/d", blink: "https://dial.to/x" }, { now, sandbox: true });
    expect(card.html).toMatch(/Sandbox/);
    expect(card.html).toMatch(/Powered by Panta/);
    expect(card.html).toMatch(/Thin/);
    expect(card.keyboard[0].map((b) => b.text)).toEqual(["🟩 Buy YES", "🟥 Buy NO"]);
    const closed = renderCard(m, v, p, { buyYes: "a", buyNo: "b", details: "c" }, { now, sandbox: true });
    expect(closed.keyboard.flat().some((b) => b.text.includes("Buy"))).toBe(false);
  });
  it("draws the split bar", () => {
    expect(splitBar(0.7)).toBe("🟩".repeat(7) + "🟥".repeat(3));
    expect(splitBar(null)).toBe("░".repeat(10));
  });
  it("estimates creator royalty from pool and tilt", () => {
    const r = estimateCreatorRoyalty({ ...m, totalVolumeUsdc: 200, trades: { ...m.trades, realWalletsYes: 9, realWalletsNo: 1 } });
    expect(r.tilt).toBeCloseTo(0.9);
    expect(r.royaltyBps).toBe(1000);
    expect(r.estimatedUsdc).toBeCloseTo(20);
  });
});

describe("actions", () => {
  it("builds a GET payload with preset and custom amounts, carrying the ref", () => {
    const a = marketActionGet({ marketId: "M1", title: "T", icon: "https://i", verdictLine: "Thin.", yesPct: 0.6, paysYes: 1.5, paysNo: 2.5, buyable: true, ref: "xBaheet_", sandbox: false });
    expect(a.links!.actions.length).toBe(7);
    expect(a.links!.actions[0].href).toBe("/api/actions/m/M1?side=yes&amount=2&ref=xBaheet_");
    expect(a.links!.actions[6].href).toContain("amount={amount}");
    expect(a.description).toMatch(/Powered by Panta/);
  });
  it("disables when not buyable", () => {
    const a = marketActionGet({ marketId: "M1", title: "T", icon: "https://i", verdictLine: "", yesPct: null, paysYes: null, paysNo: null, buyable: false, ref: "web", sandbox: true });
    expect(a.disabled).toBe(true);
    expect(a.links).toBeUndefined();
  });
  it("validates amounts and builds dial.to links + headers", () => {
    expect(parseAmount("5")).toBe(5);
    expect(parseAmount("0.1")).toBeNull();
    expect(parseAmount("9999")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(blinkUrl("https://pot.example/api/actions/m/M1")).toBe("https://dial.to/?action=solana-action%3Ahttps%3A%2F%2Fpot.example%2Fapi%2Factions%2Fm%2FM1");
    expect(actionHeaders(SOLANA_MAINNET)["X-Blockchain-Ids"]).toBe(SOLANA_MAINNET);
  });
});
