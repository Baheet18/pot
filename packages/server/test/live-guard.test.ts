import "./live-env";
import { calls } from "./env";
import { describe, expect, it } from "vitest";
import { LIVE_WRITES, pantaPost, SANDBOX } from "../src";

describe("live mode without approval", () => {
  it("blocks every Panta write before any network call", async () => {
    expect(SANDBOX).toBe(false);
    expect(LIVE_WRITES).toBe(false);
    await expect(pantaPost("/primaryorderquote/", { wallet: "x" })).rejects.toThrow(/disabled/);
    await expect(pantaPost("/markets/create/quote/", {})).rejects.toThrow(/disabled/);
    expect(calls).toHaveLength(0);
  });
});

import { verifyPractice as vp } from "../src";
describe("practice signatures in live mode", () => {
  it("are refused, so a free message can never stand in for a real payment", () => {
    expect(() => vp({ message: "x", signature: "x", wallet: "x", action: "buy", marketId: "x", ref: "x" })).toThrow(/only accepted in test mode/);
  });
});
