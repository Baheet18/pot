import { calls, M, W } from "./env";
import { beforeEach, describe, expect, it } from "vitest";
import { VersionedTransaction, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { draftMarket, linkMessage } from "@pot/core";
import {
  finishBuy, finishCreate, FlowError, globalLeaderboard, groupLeaderboard, recordBuy, resetDbForTests, saveDraft, sign, signRef,
  startBuy, startCreate, verify, verifyAndLink, walletsFor, getDraft, groupMarkets, refIsTrusted, pantaPost, buildClaim,
  compileTx, verifyPractice, newPracticeMessage, finishBuyPractice, finishCreatePractice, confirmClaimPractice,
} from "../src";
import { parsePracticeMessage } from "@pot/core";

const signText = (kp: Keypair, msg: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

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

  it("quotes + builds with the signed member ref and returns a practice message, never a transaction", async () => {
    const ref = "g-1009u42";
    const r = await startBuy({ marketId: M, side: "no", amountUsdc: 10, wallet: W, ref, rs: signRef(ref) });
    expect(r.orderId).toBe("ord_sandbox_test");
    expect(r.transaction).toBe("");
    const pm = parsePracticeMessage(r.practiceMessage!);
    expect(pm).toMatchObject({ action: "buy", wallet: W, marketId: M, ref: "ord_sandbox_test" });
    expect(r.practiceMessage).toMatch(/No real money moves/);
    const q = calls.find((c) => c.path === "/primaryorderquote/")!;
    expect(q.body).toMatchObject({ marketId: M, side: "no", amountUsdc: "10.00", userId: "pot:g-1009u42" });
    expect(q.headers["x-user-id"]).toBe("pot:g-1009u42");
    expect(calls.find((c) => c.path === "/primaryorderbuild/")!.body.maxSlippageBps).toBe(100);
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
    const d = await saveDraft(-77, 9, draftMarket("Will Arsenal beat Chelsea | tomorrow 4pm", { now: Math.floor(Date.now() / 1000) }));
    const s = await startCreate(d.id, W);
    expect(s.createId).toBe("cr_sandbox_test");
    expect(s.transaction).toBe(""); // practice mode: no transaction for the wallet
    expect(parsePracticeMessage(s.practiceMessage!)).toMatchObject({ action: "create", wallet: W, ref: "cr_sandbox_test" });
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
  it("returns a practice message instead of a claim tx", async () => {
    const r = await buildClaim("win", W, M);
    expect(r.transaction).toBe("");
    expect(parsePracticeMessage(r.practiceMessage!)).toMatchObject({ action: "claim", wallet: W, marketId: M, ref: "claim:win" });
  });
});

describe("practice mode (no transactions, ever)", () => {
  it("compileTx refuses to build any transaction in test mode", async () => {
    await expect(compileTx({ payer: W, instructions: [], recentBlockhash: "11111111111111111111111111111111" })).rejects.toThrow(/practice/);
  });

  it("verifyPractice accepts the right wallet signature and rejects wrong wallet, ref, tampering and old messages", () => {
    const kp = Keypair.generate(), w = kp.publicKey.toBase58();
    const msg = newPracticeMessage("buy", w, M, "YES $5.00", "ord_1");
    const sig = signText(kp, msg);
    const base = { message: msg, signature: sig, wallet: w, action: "buy" as const, marketId: M, ref: "ord_1" };
    expect(verifyPractice(base)).toMatch(/^sandbox_[A-Za-z0-9_-]{24}$/);
    expect(verifyPractice(base)).toBe(verifyPractice(base)); // deterministic id
    expect(() => verifyPractice({ ...base, wallet: Keypair.generate().publicKey.toBase58() })).toThrow(/match/);
    expect(() => verifyPractice({ ...base, ref: "ord_2" })).toThrow(/match/);
    expect(() => verifyPractice({ ...base, action: "claim" })).toThrow(/match/);
    expect(() => verifyPractice({ ...base, message: msg.replace("YES $5.00", "YES $500.00") })).toThrow(/signature/);
    expect(() => verifyPractice({ ...base, signature: signText(Keypair.generate(), msg) })).toThrow(/signature/);
    expect(() => verifyPractice({ ...base, now: Math.floor(Date.now() / 1000) + 3600 })).toThrow(/expired/);
    expect(() => verifyPractice({ ...base, message: "hello" })).toThrow(/practice message/);
  });

  it("finishBuyPractice records the sandbox buy after a valid free signature", async () => {
    const kp = Keypair.generate(), w = kp.publicKey.toBase58();
    const ref = "g-1009u42";
    const msg = newPracticeMessage("buy", w, M, "YES $5.00", "ord_sandbox_test");
    const f = await finishBuyPractice({ orderId: "ord_sandbox_test", quoteId: "qt_sandbox_test", wallet: w, marketId: M, side: "yes", amountUsdc: 5, ref, rs: signRef(ref), channel: "web", practiceMessage: msg, practiceSignature: signText(kp, msg) });
    expect(f).toMatchObject({ status: "confirmed", recorded: true, sandbox: true });
    const submit = calls.find((c) => c.path === "/primaryordersubmit/")!;
    expect(submit.body.signature).toMatch(/^sandbox_/);
    expect((await groupLeaderboard(-1009)).totals.buys).toBe(1);
    await expect(finishBuyPractice({ orderId: "ord_other", wallet: w, marketId: M, side: "yes", amountUsdc: 5, channel: "web", practiceMessage: msg, practiceSignature: signText(kp, msg) })).rejects.toThrow(/match/);
  });

  it("finishCreatePractice registers only for the wallet that started it", async () => {
    const kp = Keypair.generate(), w = kp.publicKey.toBase58();
    const d = await saveDraft(-78, 9, draftMarket("Will Arsenal beat Chelsea | tomorrow 4pm", { now: Math.floor(Date.now() / 1000) }));
    const s = await startCreate(d.id, w);
    const sig = signText(kp, s.practiceMessage!);
    await expect(finishCreatePractice(d.id, s.createId, W, s.practiceMessage!, sig)).rejects.toThrow(/same wallet/);
    const f = await finishCreatePractice(d.id, s.createId, w, s.practiceMessage!, sig);
    expect(f.marketId).toBe(M);
    expect((await getDraft(d.id))?.status).toBe("created");
  });

  it("confirmClaimPractice checks the signature", () => {
    const kp = Keypair.generate(), w = kp.publicKey.toBase58();
    const msg = newPracticeMessage("claim", w, M, "winnings", "claim:win");
    expect(confirmClaimPractice("win", w, M, msg, signText(kp, msg))).toMatchObject({ claimed: true, practice: true });
    expect(() => confirmClaimPractice("creator", w, M, msg, signText(kp, msg))).toThrow(/match/);
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
