import { calls, M, W } from "./env";
import { beforeEach, describe, expect, it } from "vitest";
import { VersionedTransaction, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { draftMarket, linkMessage } from "@pot/core";
import {
  finishBuy, finishCreate, FlowError, globalLeaderboard, groupLeaderboard, recordBuy, resetDbForTests, saveDraft, sign, signRef,
  startBuy, startCreate, verify, verifyAndLink, walletsFor, getDraft, groupMarkets, refIsTrusted, pantaPost, buildClaim, MEMO_PROGRAM,
} from "../src";

beforeEach(async () => { await resetDbForTests(":memory:"); calls.length = 0; });

describe("tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = sign({ d: "d_1", u: 5 }, 60);
    expect(verify<{ d: string }>(t)?.d).toBe("d_1");
    const [p, s] = t.split(".");
    expect(verify(`${p}x.${s}`)).toBeNull();
    expect(verify(sign({ a: 1 }, -1))).toBeNull();
    expect(verify("garbage")).toBeNull();
  });
  it("group refs need a signature, web/x refs don't", () => {
    expect(refIsTrusted("g-100", signRef("g-100"))).toBe(true);
    expect(refIsTrusted("g-100", signRef("g-101"))).toBe(false);
    expect(refIsTrusted("g-100", null)).toBe(false);
    expect(refIsTrusted("xbaheet_", null)).toBe(true);
  });
});

describe("store", () => {
  const base = { marketId: M, wallet: W, side: "yes" as const, amountUsdc: 5, ref: "g-1u2", pantaUserId: "pot:g-1u2", chatId: -1, sharerTgId: 2, sharerX: null, newToPanta: true, pantaStatus: "confirmed", attributed: true, channel: "web" as const };
  it("records buys once and tracks first-time Pot wallets", async () => {
    expect(await recordBuy({ ...base, signature: "s1" })).toEqual({ inserted: true, newToPot: true });
    expect((await recordBuy({ ...base, signature: "s1" })).inserted).toBe(false);
    expect((await recordBuy({ ...base, signature: "s2", newToPanta: false })).newToPot).toBe(false);
    const b = await groupLeaderboard(-1);
    expect(b.totals).toMatchObject({ buys: 2, wallets: 1, newToPot: 1, newToPanta: 1, volumeUsdc: 10 });
    expect(b.members[0]).toMatchObject({ sharer_tg_id: 2, wallets: 1 });
    expect((await globalLeaderboard())[0]).toMatchObject({ source: "group", chat_id: -1 });
  });
});

describe("buy flow (sandbox fixtures)", () => {
  it("validates input before calling Panta", async () => {
    await expect(startBuy({ marketId: M, side: "yes", amountUsdc: 5, wallet: "nope" })).rejects.toBeInstanceOf(FlowError);
    await expect(startBuy({ marketId: M, side: "maybe", amountUsdc: 5, wallet: W })).rejects.toThrow(/side/);
    await expect(startBuy({ marketId: M, side: "yes", amountUsdc: 0.5, wallet: W })).rejects.toThrow(/between/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("quotes + builds with the signed member ref and returns a signable devnet memo tx", async () => {
    const ref = "g-1009u42";
    const r = await startBuy({ marketId: M, side: "no", amountUsdc: 10, wallet: W, ref, rs: signRef(ref) });
    expect(r.orderId).toBe("ord_sandbox_test");
    expect(r.sandboxMemo).toBe(true);
    const q = calls.find((c) => c.path === "/primaryorderquote/")!;
    expect(q.body).toMatchObject({ marketId: M, side: "no", amountUsdc: "10.00", userId: "pot:g-1009u42" });
    expect(q.headers["x-user-id"]).toBe("pot:g-1009u42");
    expect(calls.find((c) => c.path === "/primaryorderbuild/")!.body.maxSlippageBps).toBe(100);
    const tx = VersionedTransaction.deserialize(Buffer.from(r.transaction, "base64"));
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(W);
    expect(tx.message.staticAccountKeys.some((k) => k.equals(MEMO_PROGRAM))).toBe(true);
  });

  it("downgrades a forged group ref to web", async () => {
    await startBuy({ marketId: M, side: "yes", amountUsdc: 2, wallet: W, ref: "g-1009", rs: "forged" });
    expect(calls.find((c) => c.path === "/primaryorderquote/")!.body.userId).toBe("pot:web");
  });

  it("finish submits, verifies, reports and records", async () => {
    const ref = "g-1009u42";
    const f = await finishBuy({ orderId: "ord_sandbox_test", quoteId: "qt_sandbox_test", signature: "sandbox_abcdef123", wallet: W, marketId: M, side: "yes", amountUsdc: 5, ref, rs: signRef(ref), channel: "blink" });
    expect(f).toMatchObject({ status: "confirmed", attributed: true, recorded: true, newToPot: true });
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(["/primaryordersubmit/", "/primaryorderverify/", "/trades/"]));
    expect((await groupLeaderboard(-1009)).totals.buys).toBe(1);
    await expect(finishBuy({ orderId: "ord_x", signature: "not a sig", wallet: W, marketId: M, side: "yes", amountUsdc: 5, channel: "web" })).rejects.toThrow(/signature/i);
  });
});

describe("create flow (sandbox fixtures)", () => {
  it("quotes with an image + group userId, then registers and links to the group", async () => {
    const now = Math.floor(Date.UTC(2026, 9, 3, 12) / 1000);
    const d = await saveDraft(-77, 9, draftMarket("Will Arsenal beat Chelsea on Sunday 4pm?", { now }));
    const s = await startCreate(d.id, W);
    expect(s.createId).toBe("cr_sandbox_test");
    expect(s.transaction.length).toBeGreaterThan(50); // sandbox memo swapped in for the empty tx
    const q = calls.find((c) => c.path === "/markets/create/quote/")!.body;
    expect(q.imageUrl).toMatch(/^https:\/\//);
    expect(q.userId).toBe("pot:g-77");
    const f = await finishCreate(d.id, s.createId, "sandbox_create123");
    expect(f.marketId).toBe(M);
    expect((await getDraft(d.id))?.status).toBe("created");
    expect((await groupMarkets(-77))[0]).toMatchObject({ market_id: M, created_by_group: 1, creator_wallet: W });
    await expect(startCreate(d.id, W)).rejects.toThrow(/already/);
  });
});

describe("claims", () => {
  it("builds signable claim txs", async () => {
    const r = await buildClaim("win", W, M);
    expect(VersionedTransaction.deserialize(Buffer.from(r.transaction, "base64")).message.staticAccountKeys[0].toBase58()).toBe(W);
  });
});

describe("wallet link", () => {
  it("accepts the right signed message and rejects others", async () => {
    const kp = Keypair.generate();
    const w = kp.publicKey.toBase58();
    const t = sign({ u: 42, a: "link" }, 60);
    const good = bs58.encode(nacl.sign.detached(new TextEncoder().encode(linkMessage(w, t)), kp.secretKey));
    expect(await verifyAndLink(t, w, good)).toEqual({ linked: true, tgUserId: 42 });
    expect(await walletsFor(42)).toContain(w);
    const bad = bs58.encode(nacl.sign.detached(new TextEncoder().encode("other"), kp.secretKey));
    await expect(verifyAndLink(t, w, bad)).rejects.toThrow(/does not match/);
    await expect(verifyAndLink(sign({ u: 42, a: "create" }), w, good)).rejects.toThrow(/expired/);
  });
});

describe("write guard", () => {
  it("only allowlisted paths can be posted", async () => {
    await expect(pantaPost("/account/keys/" as never, {})).rejects.toThrow(/not allowed/);
  });
});
