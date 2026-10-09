import { calls, M } from "./env";
import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { MarketDraft } from "@pot/core";
import {
  finishBuyPractice, finishCreatePractice, getMarketView, linkWallet, listOpenViews, practicePositions, recordBuy, resetDbForTests,
  saveDraft, signRef, startBuy, startCreate, testDataSummary, topGroups, topPeople, upsertGroup, upsertMember, wipeTestData, walletOwnerName,
} from "../src";

const signText = (kp: Keypair, msg: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
const now = () => Math.floor(Date.now() / 1000);
const CHAT = -1001234567890;

/** A realistic AI-style draft: the Tinubu 2027 question. Times are relative to now so the test never goes stale. */
function tinubuDraft(): MarketDraft {
  const t = now();
  return {
    kind: "ai", drafter: "ai",
    title: "Tinubu wins 2027 presidential election?",
    question: "Will Bola Ahmed Tinubu be declared winner of Nigeria's 2027 presidential election by INEC?",
    description: "Nigeria's next presidential election is scheduled for early 2027.",
    resolutionRule: "Resolves YES if the Independent National Electoral Commission (INEC) officially declares Bola Ahmed Tinubu the winner of the 2027 Nigerian presidential election before the event deadline. Resolves NO if INEC declares any other candidate the winner, or if no winner is declared before the deadline. A court ruling after the declaration does not change the result of this market. If the election is postponed past the deadline, this market resolves NO.",
    sourcesOfTruth: ["https://inecnigeria.org", "https://www.premiumtimesng.com"],
    category: "politics", region: "Nigeria",
    startTime: t + 5 * 86400, endTime: t + 150 * 86400, resolutionTime: t + 157 * 86400,
    marketType: "standard", creationFeeUsdc: 50, eventInProgress: false, warnings: [],
  };
}

async function createPractice() {
  const admin = Keypair.generate();
  await upsertGroup(CHAT, "Naija Politics Chat");
  const d = await saveDraft(CHAT, 9, tinubuDraft());
  const s = await startCreate(d.id, admin.publicKey.toBase58(), d.admin_id);
  const f = await finishCreatePractice(d.id, s.createId, admin.publicKey.toBase58(), s.practiceMessage!, signText(admin, s.practiceMessage!));
  return f.marketId;
}

async function practiceBuy(id: string, kp: Keypair, side: "yes" | "no", amount: number, ref = `g${CHAT}`) {
  const w = kp.publicKey.toBase58();
  const s = await startBuy({ marketId: id, side, amountUsdc: amount, wallet: w, ref, rs: signRef(ref) });
  return finishBuyPractice({ orderId: s.orderId, quoteId: s.quoteId, wallet: w, marketId: id, side, amountUsdc: amount, ref, rs: signRef(ref), channel: "telegram", practiceMessage: s.practiceMessage!, practiceSignature: signText(kp, s.practiceMessage!) });
}

beforeEach(async () => { await resetDbForTests(":memory:"); calls.length = 0; });

describe("practice markets (test mode)", () => {
  it("show the group's own drafted market, not Panta's sandbox fixture", async () => {
    const id = await createPractice();
    const v = await getMarketView(id);
    expect(v.practice).toBe(true);
    expect(v.chatId).toBe(CHAT);
    expect(v.market.title).toContain("Tinubu");
    expect(v.market.category).toBe("politics");
    expect(v.market.resolutionRule).toContain("INEC");
    expect(v.market.sources).toEqual(["https://inecnigeria.org", "https://www.premiumtimesng.com"]);
    expect(v.buyable).toBe(true);
    expect(Math.abs(v.market.startTime - tinubuDraft().startTime)).toBeLessThan(5);
    expect(calls.filter((c) => c.path.includes(id))).toHaveLength(0); // Panta never asked about it
    expect((await listOpenViews(10)).map((x) => x.market.id)).toContain(id);
  });

  it("practice buys move the pool, split and wallets; nothing goes to Panta", async () => {
    const id = await createPractice();
    const before = await getMarketView(id);
    expect(before.market.totalVolumeUsdc).toBeCloseTo(5, 5); // seed only
    expect(before.stats.realWallets).toBe(0);
    const buyers = Array.from({ length: 8 }, () => Keypair.generate());
    for (const [i, kp] of buyers.entries()) {
      const r = await practiceBuy(id, kp, i % 3 === 2 ? "no" : "yes", 15);
      expect(r).toMatchObject({ status: "confirmed", recorded: true, practice: true });
    }
    const after = await getMarketView(id);
    expect(after.market.totalVolumeUsdc).toBeCloseTo(125, 5);
    expect(after.stats.realWallets).toBe(8);
    expect(after.stats.realWalletsYes).toBe(6);
    expect(after.stats.yesSplit!).toBeGreaterThan(0.6);
    expect(before.stats.yesSplit).toBeNull();
    expect(Object.keys(after)).not.toContain("verdict");
    expect(after.payout.perYesShare).not.toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const pos = await practicePositions([buyers[0].publicKey.toBase58()]);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ marketId: id, side: "yes", amountUsdc: 15, open: true });
    expect(pos[0].title).toContain("Tinubu");
    expect(pos[0].paysIfWin).toBeGreaterThan(15);
  });

  it("rejects a signed message that doesn't match the order, and replays don't double count", async () => {
    const id = await createPractice();
    const kp = Keypair.generate(), w = kp.publicKey.toBase58();
    const s = await startBuy({ marketId: id, side: "yes", amountUsdc: 5, wallet: w });
    const sig = signText(kp, s.practiceMessage!);
    await expect(finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side: "yes", amountUsdc: 50, channel: "web", practiceMessage: s.practiceMessage!, practiceSignature: sig })).rejects.toThrow(/match/);
    await expect(finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side: "no", amountUsdc: 5, channel: "web", practiceMessage: s.practiceMessage!, practiceSignature: sig })).rejects.toThrow(/match/);
    const ok = await finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side: "yes", amountUsdc: 5, channel: "web", practiceMessage: s.practiceMessage!, practiceSignature: sig });
    expect(ok.recorded).toBe(true);
    const again = await finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side: "yes", amountUsdc: 5, channel: "web", practiceMessage: s.practiceMessage!, practiceSignature: sig });
    expect(again.recorded).toBe(false);
    expect((await getMarketView(id)).market.totalVolumeUsdc).toBeCloseTo(10, 5);
  });

  it("the sandbox fixture still works for /post-ed Panta markets", async () => {
    const v = await getMarketView(M);
    expect(v.practice).toBe(false);
  });
});

describe("leaderboards and wiping test data", () => {
  it("names groups and people (Telegram name or short wallet), no 'Website' row", async () => {
    const id = await createPractice();
    const a = Keypair.generate(), b = Keypair.generate();
    await upsertMember(5550001, "@ada");
    await linkWallet(5550001, a.publicKey.toBase58());
    await practiceBuy(id, a, "yes", 20, `g${CHAT}u5550001`);
    await practiceBuy(id, b, "no", 5, `g${CHAT}u5550001`);
    await practiceBuy(id, Keypair.generate(), "yes", 3, "web");
    const g = await topGroups();
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ chat_id: CHAT, title: "Naija Politics Chat", wallets: 2, buys: 2, volume: 25 });
    const p = await topPeople();
    expect(p[0]).toMatchObject({ name: "@ada", telegram: true, volume: 20, brought: 2 });
    const short = `${b.publicKey.toBase58().slice(0, 4)}…${b.publicKey.toBase58().slice(-4)}`;
    expect(p.map((x) => x.name)).toContain(short);
    expect(p.map((x) => x.name)).not.toContain("Website");
    expect(await walletOwnerName(a.publicKey.toBase58())).toBe("@ada");
  });

  it("wipeTestData removes test rows and fixture members but keeps real people's wallet links", async () => {
    const id = await createPractice();
    await linkWallet(5550002, Keypair.generate().publicKey.toBase58()); // real-looking Telegram id
    await linkWallet(42, Keypair.generate().publicKey.toBase58()); // script fixture
    await upsertMember(42, "Ada (fixture)");
    await practiceBuy(id, Keypair.generate(), "yes", 5);
    await recordBuy({ signature: "s_web", marketId: M, wallet: Keypair.generate().publicKey.toBase58(), side: "yes", amountUsdc: 5, ref: "web", pantaUserId: "pot:web", chatId: null, sharerTgId: null, sharerX: null, newToPanta: false, pantaStatus: "confirmed", attributed: false, channel: "web" });
    const s = await testDataSummary();
    expect(s).toMatchObject({ buys: 2, practice_markets: 1, drafts: 1, chat_groups: 1, wallet_links_fake: 1, wallet_links_real_kept: 1, members_fake: 1 });
    await wipeTestData();
    expect(await testDataSummary()).toMatchObject({ buys: 0, practice_markets: 0, drafts: 0, group_markets: 0, chat_groups: 0, wallet_links_fake: 0, wallet_links_real_kept: 1, members_fake: 0 });
    await expect(getMarketView(id)).rejects.toThrow();
    expect(await topGroups()).toEqual([]);
    expect(await topPeople()).toEqual([]);
  });
});

describe("unknown ids in test mode", () => {
  it("say not found instead of showing Panta's sandbox fixture", async () => {
    await expect(getMarketView("3PVyfS2oHBsszDQRLYKNRsx5UcC6x7C2Sc7cco3e4B6B")).rejects.toThrow(/doesn't exist/);
  });
});

describe("sharing without dial.to", () => {
  it("the Action GET for a practice market uses our own icon and real title; share links are our URL + an X intent", async () => {
    const { actionGetFor, xShareFor, blinkFor, shareTextFor } = await import("../src");
    const id = await createPractice();
    const { payload, view } = await actionGetFor(id, `g${CHAT}`, signRef(`g${CHAT}`));
    expect(payload.title).toContain("Tinubu");
    expect(payload.icon).toBe(`https://pot.example/api/og/${id}?sq=1`);
    expect(payload.links!.actions[0].href).toContain(`ref=g${CHAT}`);
    const ref = { kind: "group" as const, chatId: CHAT };
    expect(blinkFor(id, ref)).toMatch(new RegExp(`^https://pot.example/m/${id}\\?ref=g${CHAT}&rs=`));
    const x = new URL(xShareFor(id, ref, shareTextFor(view)));
    expect(x.host).toBe("x.com");
    expect(x.searchParams.get("url")).toBe(blinkFor(id, ref));
    expect(x.searchParams.get("text")).toContain("practice market");
    expect(JSON.stringify(payload) + x.href).not.toContain("dial.to");
  });
});
