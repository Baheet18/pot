import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeMarket } from "../src/normalize";
import { estimatePayout } from "../src/payout";
import { computeReceipt, formatReceiptHtml, type ReceiptBuy } from "../src/receipt";
import { PANTA_PRIMARY_FEE_RATE } from "../src/config";
import type { RawDetail, RawTrade } from "../src/types";

const raw = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "haaland.json"), "utf8")) as { detail: RawDetail; trades: RawTrade[] };
const resolved = (yesWins: boolean) => ({ ...normalizeMarket(raw.detail, raw.trades), isResolved: true, yesWins });
const sig = (p: string) => raw.trades.find((t) => t.signature.startsWith(p))!;

describe("settlement receipt math (live rules)", () => {
  const t1 = sig("365SYRnP"), t2 = sig("2UKVYc1u");
  const buys: ReceiptBuy[] = [
    { signature: t1.signature, wallet: t1.wallet, side: "yes", amountUsdc: 40, chatId: -1 },
    { signature: t2.signature, wallet: t2.wallet, side: "no", amountUsdc: 5, chatId: -1 },
    { signature: "not-on-the-tape", wallet: "Fallback1111111111111111111111111", side: "yes", amountUsdc: 10, chatId: -1 },
    { signature: "elsewhere", wallet: "Other22222222222222222222222222222", side: "no", amountUsdc: 7, chatId: -2 },
  ];

  it("winners: shares × payout per winning share; unknown shares fall back to pro-rata money; losers lose stake + 2% fee", () => {
    const m = resolved(true), p = estimatePayout(m);
    const r = computeReceipt(m, p, raw.trades, buys, { names: new Map([[t1.wallet, "Ada"]]), practice: false, feeRate: PANTA_PRIMARY_FEE_RATE, chatId: -1 });
    expect(r.outcome).toBe("yes");
    expect(r.perWinningShare).toBe(p.perYesShare);
    const ada = r.people.find((x) => x.name === "Ada")!;
    expect(ada.payout).toBeCloseTo(Number(t1.shares) * p.perYesShare!, 6);
    expect(ada.fee).toBeCloseTo(0.8, 6);
    expect(ada.net).toBeCloseTo(ada.payout - 40 - 0.8, 6);
    const fb = r.people.find((x) => x.wallet.startsWith("Fallback"))!;
    expect(fb.payout).toBeCloseTo((10 / m.yesMoneyUsdc) * p.winnerPoolUsdc, 6);
    const loser = r.people.find((x) => x.wallet === t2.wallet)!;
    expect(loser.won).toBe(false);
    expect(loser.payout).toBe(0);
    expect(loser.net).toBeCloseTo(-5.1, 6);
    expect(r.others).toEqual({ people: 1, stake: 7 });
    expect(r.winnerPoolUsdc + r.royaltyUsdc).toBeCloseTo(r.potUsdc, 6);
    // Winners first.
    expect(r.people[0].won).toBe(true);

    const html = formatReceiptHtml(r);
    expect(html).toContain("🧾 <b>RECEIPT</b>");
    expect(html).not.toContain("practice");
    expect(html).toContain("Result: ✅ <b>YES</b>");
    expect(html).toMatch(/🏆 Ada · YES \$40\.00 → ≈\$/);
    expect(html).toMatch(/💸 BZva…\w{4} · NO \$5\.00 → \$0 \(−\$5\.10\)/);
    expect(html).toContain("+ 1 buyer from outside this group ($7.00)");
    expect(html).toContain("2% trading fee");
    expect(html).toContain("1-hour dispute window");
  });

  it("refuses an unresolved market and escapes names", () => {
    const m = normalizeMarket(raw.detail, raw.trades);
    expect(() => computeReceipt({ ...m, isResolved: false }, estimatePayout(m), raw.trades, buys, { practice: false, feeRate: 0.02 })).toThrow(/isn't resolved/);
    const r = computeReceipt(resolved(false), estimatePayout(resolved(false)), raw.trades, buys.slice(0, 1), { names: new Map([[t1.wallet, "<b>x</b>"]]), practice: true, feeRate: 0 });
    const html = formatReceiptHtml(r);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("Result: ❌ <b>NO</b>");
    expect(html).toContain("Practice money only");
  });

  it("shows an empty-group line and caps long lists", () => {
    const m = resolved(true);
    const empty = computeReceipt(m, estimatePayout(m), raw.trades, [], { practice: true, feeRate: 0, chatId: -9 });
    expect(formatReceiptHtml(empty)).toContain("Nobody in this group bought this one.");
    const many: ReceiptBuy[] = Array.from({ length: 30 }, (_, i) => ({ signature: `s${i}`, wallet: `W${String(i).padStart(40, "0")}`, side: "yes", amountUsdc: 1, chatId: null }));
    const big = computeReceipt(m, estimatePayout(m), raw.trades, many, { practice: true, feeRate: 0 });
    expect(formatReceiptHtml(big, { maxPeople: 10 })).toContain("…and 20 more");
  });
});
