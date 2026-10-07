import "./env";
import { calls, overrides, W, M } from "./env";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { friendlyWalletError, receiptDue } from "@pot/core";
import {
  checkCreateQuote, finishBuy, FlowError, friendlyPantaMessage, fundsProblem, getOrder, isAlreadySubmitted, liveReadiness, PantaError, startBuy, buysForMarket,
} from "../src";

const SIG = "5".repeat(88);

describe("buy orders are remembered server-side", () => {
  it("records the quoted side/amount even if the client sends different ones back", async () => {
    const s = await startBuy({ marketId: M, side: "no", amountUsdc: 10, wallet: W });
    expect(await getOrder(s.orderId)).toMatchObject({ side: "no", amount_usdc: 10, wallet: W, market_id: M });
    const f = await finishBuy({ orderId: s.orderId, signature: SIG, wallet: W, marketId: M, side: "yes", amountUsdc: 500, channel: "web" });
    expect(f.status).toBe("confirmed");
    expect(f.pending).toBe(false);
    const b = (await buysForMarket(M)).find((x: any) => x.signature === SIG)!;
    expect(b).toMatchObject({ side: "no" });
    expect(Number(b.amount_usdc)).toBe(10);
    const trades = calls.filter((c) => c.path === "/trades/").pop()!;
    expect(trades.body.quoteId).toBe(s.quoteId);
  });
  it("refuses to finish an order for another wallet", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    await expect(finishBuy({ orderId: "ord_sandbox_test", signature: SIG, wallet: other, marketId: M, side: "no", amountUsdc: 10, channel: "web" }))
      .rejects.toMatchObject({ code: "WRONG_WALLET" });
  });
  it("is retry-safe: an 'already submitted' answer from Panta just re-verifies", async () => {
    overrides["POST /primaryordersubmit/"] = () => ({ status: 409, json: { code: "ORDER_ALREADY_SUBMITTED" } });
    try {
      const f = await finishBuy({ orderId: "ord_sandbox_test", signature: SIG, wallet: W, marketId: M, side: "no", amountUsdc: 10, channel: "web" });
      expect(f.status).toBe("confirmed");
    } finally { delete overrides["POST /primaryordersubmit/"]; }
  });
  it("reports 'pending' instead of failing when Solana is slow, so the buyer checks again rather than paying twice", async () => {
    overrides["POST /primaryorderverify/"] = () => ({ status: 200, json: { status: "submitted" } });
    const real = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void) => real(fn, 0);
    try {
      const f = await finishBuy({ orderId: "ord_sandbox_test", signature: "6".repeat(88), wallet: W, marketId: M, side: "no", amountUsdc: 10, channel: "web" });
      expect(f).toMatchObject({ status: "submitted", pending: true, recorded: false });
    } finally { delete overrides["POST /primaryorderverify/"]; (globalThis as any).setTimeout = real; }
  });
});

describe("create quote must match Pot's fee", () => {
  it("accepts $20 breaking / $50 standard in base units (as the live API returns)", () => {
    expect(checkCreateQuote({ paymentUsdc: "20000000", marketType: "breaking" }, { marketType: "breaking" })).toBe(20);
    expect(checkCreateQuote({ paymentUsdc: "50000000", marketType: "standard" }, { marketType: "standard" })).toBe(50);
  });
  it("refuses a different price or market type before anything is signed", () => {
    expect(() => checkCreateQuote({ paymentUsdc: "50000000", marketType: "standard" }, { marketType: "breaking" })).toThrow(FlowError);
    expect(() => checkCreateQuote({ paymentUsdc: "20000000" }, { marketType: "standard" })).toThrow(/\$20\.00 but Pot shows \$50/);
    expect(() => checkCreateQuote({ paymentUsdc: "20" }, { marketType: "breaking" })).toThrow(/FEE|quoted/);
  });
});

describe("plain-words errors", () => {
  it("maps Panta codes seen on the live API (they arrive without a message)", () => {
    expect(friendlyPantaMessage("NOT_CLAIMABLE", undefined, 400)).toMatch(/Nothing to claim/);
    expect(friendlyPantaMessage("NOT_MARKET_CREATOR", undefined, 400)).toMatch(/isn't the creator/);
    expect(friendlyPantaMessage("DUPLICATE_MARKET", "market creation is already active", 400)).toMatch(/already in progress/);
    expect(friendlyPantaMessage("QUOTE_EXPIRED", undefined, 400)).toMatch(/fresh quote/);
    expect(friendlyPantaMessage("WEIRD", undefined, 503)).toMatch(/Nothing was charged/);
    expect(friendlyPantaMessage("WEIRD", "Panta says no", 400)).toBe("Panta says no");
    expect(isAlreadySubmitted(new PantaError(409, "X", "x"))).toBe(true);
    expect(isAlreadySubmitted(new PantaError(400, "BAD_SIGNATURE", "x"))).toBe(false);
  });
  it("maps wallet errors", () => {
    expect(friendlyWalletError(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toMatch(/cancelled/);
    expect(friendlyWalletError(new Error("Transaction simulation failed: insufficient lamports 100, need 2039280"))).toMatch(/SOL/);
    expect(friendlyWalletError(new Error("custom program error: 0x1"))).toMatch(/USDC/);
    expect(friendlyWalletError(new Error("Blockhash not found"))).toMatch(/expired/);
    expect(friendlyWalletError(new Error("This wallet has $3.00 USDC; this needs $10.20"))).toMatch(/\$3\.00/);
  });
  it("checks funds before a live signature", () => {
    expect(fundsProblem({ sol: 0.05, usdc: 5 }, 10.2)?.code).toBe("INSUFFICIENT_USDC");
    expect(fundsProblem({ sol: 0.001, usdc: 50 }, 10.2)?.code).toBe("INSUFFICIENT_SOL");
    expect(fundsProblem({ sol: 0.05, usdc: 50 }, 10.2)).toBeNull();
    expect(fundsProblem(null, 10.2)).toBeNull(); // RPC down: don't block
  });
});

describe("live receipts wait for Panta's dispute window", () => {
  const m = { isResolved: true, resolvedAt: 1_000_000, resolutionTime: 999_000 };
  it("posts practice receipts at once, live ones only an hour after the result", () => {
    expect(receiptDue(m, 1_000_010, false)).toBe(true);
    expect(receiptDue(m, 1_000_010, true)).toBe(false);
    expect(receiptDue(m, 1_003_600, true)).toBe(true);
    expect(receiptDue({ ...m, isResolved: false }, 2_000_000, true)).toBe(false);
  });
});

describe("go-live readiness", () => {
  it("is not ready in the current (test) setup and never echoes values", () => {
    const r = liveReadiness({ PANTA_MODE: "test", POT_PANTA_LIVE_KEY: "pk_live_secretvalue123" });
    expect(r.ready).toBe(false);
    expect(r.liveWrites).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secretvalue");
  });
  it("is ready only with every switch in place", () => {
    const env = {
      PANTA_MODE: "live", POT_ALLOW_LIVE_WRITES: "1", POT_PANTA_LIVE_KEY: "pk_live_x", SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=x",
      POT_DEFAULT_IMAGE_URL: "https://pot.example/market.png", DATABASE_URL: "postgres://x", CRON_SECRET: "c", POT_TELEGRAM_TOKEN: "t", POT_HMAC_SECRET: "h",
    };
    expect(liveReadiness(env).ready).toBe(true);
    expect(liveReadiness({ ...env, SOLANA_RPC_URL: "https://api.devnet.solana.com" }).ready).toBe(false);
    expect(liveReadiness({ ...env, POT_DEFAULT_IMAGE_URL: "https://res.cloudinary.com/demo/image/upload/sample.jpg" }).ready).toBe(false);
    expect(liveReadiness({ ...env, POT_ALLOW_LIVE_WRITES: "0" }).liveWrites).toBe(false);
  });
});
