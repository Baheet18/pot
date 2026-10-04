import { describe, expect, it } from "vitest";
import { parsePracticeMessage, practiceMessage, PRACTICE_BANNER } from "../src";

describe("practice message", () => {
  const f = { action: "buy" as const, wallet: "BSCDDRaVGiLJERmoNWTgAGcend9FUUhXEHnLFTqZHDxW", marketId: "M1", detail: "YES $5.00", ref: "ord_1", ts: 1_790_000_000 };
  it("round-trips and says plainly that no money moves", () => {
    const m = practiceMessage(f);
    expect(parsePracticeMessage(m)).toEqual(f);
    expect(m).toMatch(/No real money moves/);
    expect(PRACTICE_BANNER).toMatch(/no real money/i);
  });
  it("keeps injected newlines out of the fields and rejects other text", () => {
    const m = practiceMessage({ ...f, detail: "a\nRef: evil" });
    expect(parsePracticeMessage(m)?.ref).toBe("ord_1");
    expect(parsePracticeMessage("hello")).toBeNull();
    expect(parsePracticeMessage(m.replace("buy", "sell"))).toBeNull();
  });
});
