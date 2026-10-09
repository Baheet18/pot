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

import { finishBuy as fb, setFundsReader } from "../src";
describe("live hardening without approval", () => {
  it("refuses to finish an order Pot never quoted (no client-made orders)", async () => {
    await expect(fb({ orderId: "ord_made_up", signature: "5".repeat(88), wallet: "BSCDDRaVGiLJERmoNWTgAGcend9FUUhXEHnLFTqZHDxW", marketId: "x", side: "yes", amountUsdc: 1, channel: "web" }))
      .rejects.toMatchObject({ code: "UNKNOWN_ORDER" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
  it("funds reader is injectable (tests never hit mainnet RPC)", () => { setFundsReader(async () => ({ sol: 1, usdc: 1 })); setFundsReader(null); });
});

import { checkPermissions } from "../src/secrets";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
describe("secret file permissions", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "pot-perm-")), "k");
  writeFileSync(f, "x"); chmodSync(f, 0o644);
  it("refuse a group/world-readable file on POSIX", () => expect(() => checkPermissions(f, "Test key", "linux")).toThrow(/chmod 600/));
  it("only warn on Windows, which has no POSIX modes", () => expect(() => checkPermissions(f, "Test key", "win32")).not.toThrow());
});
