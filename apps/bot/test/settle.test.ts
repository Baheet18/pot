import { M } from "../../../packages/server/test/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { draftMarket } from "@pot/core";
import {
  buildReceipt, claimReceipt, finishBuyPractice, finishCreatePractice, getMarketView, linkWallet, practicePositions, resetDbForTests, saveDraft,
  settlePracticeMarket, signRef, startBuy, startCreate, upsertGroup, upsertMember,
} from "@pot/server";
import { createBot, postReceipt, settleTick } from "../src/bot";

void M;
type U = { id: number; is_bot: boolean; first_name: string; username?: string };
const GROUP = { id: -100777, type: "supergroup" as const, title: "Naija Ballers" };
const OTHER = { id: -100888, type: "supergroup" as const, title: "Other Group" };
const ADMIN: U = { id: 7, is_bot: false, first_name: "Baheet", username: "baheet_" };
const MEMBER: U = { id: 42, is_bot: false, first_name: "Ada" };
const signText = (kp: Keypair, m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));

function makeBot(adminIds: number[] = [7]) {
  const sent: Array<{ method: string; payload: any }> = [];
  const bot = createBot("123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxx", {
    botInfo: { id: 1, is_bot: true, first_name: "Pot", username: "pantapotbot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any,
  });
  let mid = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    if (method === "getChatMember") return { ok: true, result: { status: adminIds.includes((payload as any).user_id) ? "administrator" : "member", user: {} } } as any;
    if (method === "sendMessage") return { ok: true, result: { message_id: ++mid, date: 0, chat: { id: (payload as any).chat_id, type: "supergroup" }, text: (payload as any).text } } as any;
    return { ok: true, result: true } as any;
  });
  let uid = 1;
  const msg = (text: string, from = ADMIN, chat: any = GROUP) => bot.handleUpdate({
    update_id: uid++,
    message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat, from, text, entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : [] },
  } as any);
  const replies = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload);
  return { bot, sent, msg, replies };
}

/** A match market: buying closes at kick-off two days from now. */
async function practiceMarket(chat = GROUP) {
  const admin = Keypair.generate(), w = admin.publicKey.toBase58();
  await upsertGroup(chat.id, chat.title);
  const d = await saveDraft(chat.id, 7, draftMarket("Will Super Eagles beat Ghana in 2 days 8pm?", { now: Math.floor(Date.now() / 1000) }));
  const s = await startCreate(d.id, w);
  return (await finishCreatePractice(d.id, s.createId, w, s.practiceMessage!, signText(admin, s.practiceMessage!))).marketId;
}
async function buy(id: string, kp: Keypair, side: "yes" | "no", amount: number, chatId = GROUP.id) {
  const ref = `g${chatId}`, w = kp.publicKey.toBase58();
  const s = await startBuy({ marketId: id, side, amountUsdc: amount, wallet: w, ref, rs: signRef(ref) });
  return finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side, amountUsdc: amount, ref, rs: signRef(ref), channel: "telegram", practiceMessage: s.practiceMessage!, practiceSignature: signText(kp, s.practiceMessage!) });
}
const afterKickoff = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 3 * 86400_000); };

beforeEach(async () => { await resetDbForTests(":memory:"); });
afterEach(() => { vi.useRealTimers(); });

describe("settlement receipts (practice markets)", () => {
  async function setup() {
    const id = await practiceMarket();
    const ada = Keypair.generate(), tolu = Keypair.generate(), kemi = Keypair.generate();
    await upsertMember(42, "Ada"); await linkWallet(42, ada.publicKey.toBase58());
    await upsertMember(43, "@tolu"); await linkWallet(43, tolu.publicKey.toBase58());
    await buy(id, ada, "yes", 20);
    await buy(id, tolu, "no", 10);
    await buy(id, kemi, "yes", 5); // unlinked wallet: shown as a short address
    return { id, ada, tolu, kemi };
  }

  it("parimutuel math: winners get shares × (pot − royalty) ÷ winning shares; losers lose their stake; no fee in practice", async () => {
    const { id, ada, tolu } = await setup();
    afterKickoff();
    await settlePracticeMarket(id, "yes", 7);
    const v = await getMarketView(id);
    expect(v.market.isResolved).toBe(true);
    expect(v.market.yesWins).toBe(true);
    expect(v.buyable).toBe(false);
    const r = await buildReceipt(v);
    expect(r.outcome).toBe("yes");
    expect(r.feeRate).toBe(0);
    expect(r.potUsdc).toBeCloseTo(40, 1); // 35 bought + 2.5 + 2.5 creator seed
    // 3 traders, 2 on YES (67%): full 20% royalty.
    expect(r.royaltyPct).toBe(20);
    expect(r.winnerPoolUsdc).toBeCloseTo(r.potUsdc * 0.8, 2);
    const a = r.people.find((p) => p.name === "Ada")!;
    const t = r.people.find((p) => p.name === "@tolu")!;
    const pos = (await practicePositions([ada.publicKey.toBase58()]))[0];
    expect(a.won).toBe(true);
    expect(a.payout).toBeCloseTo(pos.payout, 6);
    expect(a.payout).toBeCloseTo(pos.shares * r.perWinningShare!, 6);
    expect(a.payout).toBeGreaterThan(20);
    expect(a.net).toBeCloseTo(a.payout - 20, 6);
    expect(t.won).toBe(false);
    expect(t.payout).toBe(0);
    expect(t.net).toBe(-10);
    expect(r.people.some((p) => /…/.test(p.name))).toBe(true);
    // Everything paid out (winners incl. the creator's seed shares + royalty) adds up to the pot.
    const yesShares = v.trades.filter((x) => x.side === "yes").reduce((s, x) => s + Number(x.shares), 0);
    expect(yesShares * r.perWinningShare! + r.royaltyUsdc).toBeCloseTo(r.potUsdc, 4);
    void tolu;
  });

  it("/settle: admins only, only in the market's own group, after kick-off; posts one receipt; buying stops", async () => {
    const { id } = await setup();
    const b = makeBot();
    await b.msg("/settle yes");
    expect(b.replies().at(-1).text).toMatch(/Buying is still open/);
    afterKickoff();
    await b.msg("/settle yes", MEMBER);
    expect(b.replies().at(-1).text).toMatch(/Only group admins/);
    await b.msg(`/settle ${id.slice(0, 8)} yes`, ADMIN, OTHER);
    expect(b.replies().at(-1).text).toMatch(/can't find that practice market in this group/);
    await b.msg("/settle maybe");
    expect(b.replies().at(-1).text).toMatch(/Usage/);

    await b.msg("/settle yes");
    const receipts = b.replies().filter((p) => p.text.includes("RECEIPT"));
    expect(receipts).toHaveLength(1);
    const text: string = receipts[0].text;
    expect(receipts[0].chat_id).toBe(GROUP.id);
    expect(text).toContain("Result: ✅ <b>YES</b>");
    expect(text).toMatch(/Final pot: <b>\$40\.00<\/b>/);
    expect(text).toMatch(/Creator royalty \(20%\)/);
    expect(text).toMatch(/🏆 Ada · YES \$20\.00 → ≈\$\d+\.\d\d \(≈\+\$\d+\.\d\d\)/);
    expect(text).toMatch(/💸 @tolu · NO \$10\.00 → \$0 \(−\$10\.00\)/);
    expect(text).toContain("practice");
    expect(text).toContain("approx");
    expect(text.split("\n").length).toBeLessThan(20);

    // Idempotent: a second /settle, a tick and a direct post all do nothing.
    await b.msg("/settle no");
    expect(b.replies().at(-1).text).toMatch(/no unsettled practice markets|Already settled/);
    await b.msg(`/settle ${id.slice(0, 8)} no`);
    expect(b.replies().at(-1).text).toMatch(/Already settled: YES/);
    await settleTick(b.bot);
    expect(await postReceipt(b.bot.api, GROUP.id, await getMarketView(id), { force: true })).toBe("already");
    expect(b.replies().filter((p) => p.text.includes("RECEIPT"))).toHaveLength(1);
    expect(await claimReceipt(id, GROUP.id)).toBe(false);

    // Settled markets refuse new buys and drop out of open lists.
    await expect(buy(id, Keypair.generate(), "no", 5)).rejects.toThrow(/buy-only|closed/i);

    // /mine shows the result.
    await b.msg("/mine", MEMBER, { id: 42, type: "private", first_name: "Ada" });
    expect(b.replies().at(-1).text).toMatch(/Result YES: ✅ won, pays about \$\d+\.\d\d/);
  });

  it("settleTick posts the receipt once for a resolved market (also the first time it sees it), and retries if sending failed", async () => {
    const { id } = await setup();
    afterKickoff();
    await settlePracticeMarket(id, "no", 7);
    const b = makeBot();
    let fail = true;
    b.bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "sendMessage" && fail) { fail = false; throw new Error("telegram down"); }
      return prev(method, payload, signal);
    });
    await settleTick(b.bot); // fails once → claim released
    await settleTick(b.bot); // posts
    await settleTick(b.bot); // nothing (settled_notified)
    const receipts = b.sent.filter((s) => s.method === "sendMessage" && String(s.payload.text).includes("RECEIPT"));
    expect(receipts).toHaveLength(1); // the failed attempt never reached Telegram
    expect(receipts.at(-1)!.payload.text).toContain("Result: ❌ <b>NO</b>");
    expect(receipts.at(-1)!.payload.text).toMatch(/🏆 @tolu · NO \$10\.00/);
  });

  it("a practice market settled early (operator) can't be bought any more", async () => {
    const id = await practiceMarket();
    const kp = Keypair.generate();
    const ref = `g${GROUP.id}`, w = kp.publicKey.toBase58();
    const s = await startBuy({ marketId: id, side: "yes", amountUsdc: 5, wallet: w, ref, rs: signRef(ref) });
    await settlePracticeMarket(id, "no", null);
    expect((await settlePracticeMarket(id, "yes", null)).already).toBe(true);
    await expect(finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side: "yes", amountUsdc: 5, ref, rs: signRef(ref), channel: "telegram", practiceMessage: s.practiceMessage!, practiceSignature: signText(kp, s.practiceMessage!) })).rejects.toThrow(/closed/i);
    await expect(startBuy({ marketId: id, side: "yes", amountUsdc: 5, wallet: w, ref, rs: signRef(ref) })).rejects.toThrow();
  });

  it("a group receipt lists only that group's buyers and sums up the rest", async () => {
    const id = await practiceMarket();
    await upsertGroup(OTHER.id, OTHER.title);
    await buy(id, Keypair.generate(), "yes", 8);
    await buy(id, Keypair.generate(), "no", 3, OTHER.id);
    afterKickoff();
    await settlePracticeMarket(id, "yes", 7);
    const r = await buildReceipt(await getMarketView(id), { chatId: GROUP.id });
    expect(r.people).toHaveLength(1);
    expect(r.others).toEqual({ people: 1, stake: 3 });
  });
});
