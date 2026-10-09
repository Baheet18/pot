import { M } from "../../../packages/server/test/env";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot, notifyTick, type Drafter } from "../src/bot";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { draftMarket, type MarketDraft } from "@pot/core";
import { finishBuyPractice, finishCreatePractice, getDraft, linkGroupMarket, linkWallet, recordBuy, resetDbForTests, saveDraft, signRef, startBuy, startCreate, upsertGroup, verify } from "@pot/server";

type Sent = { method: string; payload: any };
type U = { id: number; is_bot: boolean; first_name: string; username?: string };
const GROUP = { id: -100500, type: "supergroup" as const, title: "Naija Ballers" };
const ADMIN: U = { id: 7, is_bot: false, first_name: "Baheet", username: "baheet_" };
const MEMBER: U = { id: 42, is_bot: false, first_name: "Ada" };

function makeBot(adminIds: number[] = [7], drafter?: Drafter, dmBlocked: number[] = []) {
  const sent: Sent[] = [];
  const bot = createBot("123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxx", {
    drafter,
    botInfo: { id: 1, is_bot: true, first_name: "Pot", username: "pantapotbot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any,
  });
  let mid = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    if (method === "getChatMember") return { ok: true, result: { status: adminIds.includes((payload as any).user_id) ? "administrator" : "member", user: {} } } as any;
    if (method === "sendMessage" && dmBlocked.includes((payload as any).chat_id)) return { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } as any;
    if (method === "sendMessage") return { ok: true, result: { message_id: ++mid, date: 0, chat: { id: (payload as any).chat_id, type: "supergroup" }, text: (payload as any).text } } as any;
    return { ok: true, result: true } as any;
  });
  let uid = 1;
  const msg = (text: string, from = ADMIN, chat: any = GROUP, replyTo?: number, extra: Record<string, unknown> = {}) => bot.handleUpdate({
    update_id: uid++,
    message: {
      ...extra, message_id: uid, date: Math.floor(Date.now() / 1000), chat, from, text, entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : [],
      ...(replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat, from: { id: 1, is_bot: true, first_name: "Pot" }, text: "draft" } } : {}),
    },
  } as any);
  const tap = (data: string, from = ADMIN) => bot.handleUpdate({
    update_id: uid++,
    callback_query: { id: String(uid), from, chat_instance: "x", data, message: { message_id: 1, date: 0, chat: GROUP, text: "draft" } },
  } as any);
  const replies = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload);
  return { bot, sent, msg, tap, replies };
}

beforeEach(async () => { await resetDbForTests(":memory:"); });

describe("Pot bot", () => {
  it("/new drafts a market with Create/Cancel buttons; the create button gives a signed link", async () => {
    const b = makeBot();
    await b.msg("/new Will Super Eagles beat Ghana on Saturday 8pm?");
    const r = b.replies()[0];
    expect(r.text).toContain("Market draft");
    expect(r.text).toContain("Practice mode");
    const btns = r.reply_markup.inline_keyboard.flat();
    const create = btns.find((x: any) => x.text.startsWith("✅ Create"));
    expect(create).toBeTruthy();
    const draftId = create.callback_data.split(":")[1];
    expect((await getDraft(draftId))?.chat_id).toBe(GROUP.id);

    await b.tap(`create:${draftId}`, MEMBER); // not the drafting admin
    expect(b.sent.find((s) => s.method === "answerCallbackQuery")!.payload.text).toMatch(/Only the admin/);

    await b.tap(`create:${draftId}`);
    // The sign & pay link goes to the admin's DM only; the group just hears that it was sent.
    const pay = b.replies().find((r) => r.chat_id === ADMIN.id)!;
    const url: string = pay.reply_markup.inline_keyboard[0][0].url;
    expect(url).toMatch(new RegExp(`^https://pot.example/create/${draftId}\\?t=`));
    expect(verify<{ d: string; u: number }>(new URL(url).searchParams.get("t"))).toMatchObject({ d: draftId, u: ADMIN.id });
    const inGroup = b.replies().filter((r) => r.chat_id === GROUP.id).map((r) => JSON.stringify(r));
    expect(inGroup.join(" ")).not.toContain("/create/");
    expect(b.replies().at(-1).text).toMatch(/sent you the sign & pay link in a private message/);
  });

  it("if the bot can't DM the admin, it asks them to start the bot; /start c_<draft> in DM then sends the link (to that admin only)", async () => {
    const b = makeBot([7, 42], undefined, [ADMIN.id]);
    await b.msg("/new Will Super Eagles beat Ghana on Saturday 8pm?");
    const draftId = b.replies()[0].reply_markup.inline_keyboard.flat().find((x: any) => x.text.startsWith("✅ Create")).callback_data.split(":")[1];
    await b.tap(`create:${draftId}`);
    const g = b.replies().at(-1);
    expect(g.chat_id).toBe(GROUP.id);
    expect(g.text).toMatch(/can't message you yet/);
    expect(g.reply_markup.inline_keyboard[0][0].url).toBe(`https://t.me/pantapotbot?start=c_${draftId}`);
    expect(JSON.stringify(b.replies().filter((r) => r.chat_id === GROUP.id))).not.toContain("/create/");
    const b2 = makeBot([7, 42]);
    await b2.msg(`/start c_${draftId}`, MEMBER, { id: 42, type: "private", first_name: "Ada" });
    expect(b2.replies().at(-1).text).toMatch(/isn't yours/);
    await b2.msg(`/start c_${draftId}`, ADMIN, { id: 7, type: "private", first_name: "Baheet" });
    expect(b2.replies().at(-1).reply_markup.inline_keyboard[0][0].url).toContain(`/create/${draftId}?t=`);
  });

  it("anonymous admins (GroupAnonymousBot posting as the group) count as admins for /new, /admin and /settle", async () => {
    const ANON = { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" };
    const b = makeBot([7]);
    const asGroup = { sender_chat: { id: GROUP.id, type: "supergroup", title: GROUP.title } };
    await b.msg("/new Will Super Eagles beat Ghana on Saturday 8pm?", ANON as any, GROUP, undefined, asGroup);
    expect(b.replies()[0].text).toContain("Market draft");
    await b.msg("/admin", ANON as any, GROUP, undefined, asGroup);
    expect(b.replies().at(-1).text).not.toMatch(/Only group admins/);
    await b.msg("/settle yes", ANON as any, GROUP, undefined, asGroup);
    expect(b.replies().at(-1).text).not.toMatch(/Only group admins/);
    // A post "as some other channel" is not an admin.
    await b.msg("/new Will it rain in Lagos tomorrow?", ANON as any, GROUP, undefined, { sender_chat: { id: -100999, type: "channel", title: "Other" } });
    expect(b.replies().at(-1).text).toMatch(/Only group admins/);
    // A real admin then taps Create on the anonymous draft and becomes its creator; a non-admin can't.
    const draftId = b.replies()[0].reply_markup.inline_keyboard.flat().find((x: any) => x.text.startsWith("✅ Create")).callback_data.split(":")[1];
    await b.tap(`create:${draftId}`, MEMBER);
    expect(b.sent.filter((s) => s.method === "answerCallbackQuery").at(-1)!.payload.text).toMatch(/Only the admin/);
    await b.tap(`create:${draftId}`);
    expect((await getDraft(draftId))!.admin_id).toBe(ADMIN.id);
    expect(b.replies().find((r) => r.chat_id === ADMIN.id)).toBeTruthy();
  });

  it("asks for contenders by reply and feeds the admin's names straight into the split, with a Rephrase button", async () => {
    const b = makeBot([7]);
    await b.msg("/new who wins BBNaija?");
    const ask = b.replies()[0];
    expect(ask.text).toMatch(/Reply to this message with their names/);
    expect(ask.reply_markup.force_reply).toBe(true);
    const askId = b.sent.filter((s) => s.method === "sendMessage").length + 100; // fake API numbers messages from 101
    await b.msg("Kellyrae, Wanni", MEMBER, GROUP, askId); // not the admin: ignored
    expect(b.replies()).toHaveLength(1);
    await b.msg("Kellyrae, Wanni or Dede", ADMIN, GROUP, askId);
    const pick = b.replies().at(-1);
    expect(pick.text).toContain("Will Dede win BBNaija?");
    const labels = pick.reply_markup.inline_keyboard.flat().map((x: any) => x.text);
    expect(labels).toEqual(["➕ Kellyrae", "➕ Wanni", "➕ Dede", "✍️ Rephrase as one YES/NO"]);
    expect(pick.text).toContain("Will Kellyrae, Wanni or Dede win BBNaija?");
  });

  it("/new refuses personal bets politely, with a suggestion", async () => {
    const b = makeBot([7], async () => ({ kind: "refuse", message: "😅 I can't make a market on that one.", suggestion: "Try: /new Will Super Eagles beat Ghana on Saturday?" }));
    await b.msg("/new will Tolu pay me back");
    expect(b.replies()[0].text).toBe("😅 I can't make a market on that one.\n\n💡 Try: /new Will Super Eagles beat Ghana on Saturday?");
    expect(b.replies()[0].reply_markup).toBeUndefined();
  });

  it("/new on a multi-outcome question offers YES/NO markets to pick; a tap drafts that one (drafting admin only)", async () => {
    const asked: string[] = [];
    const drafter: Drafter = async (text) => {
      asked.push(text);
      if (/who wins/i.test(text)) return { kind: "multi", question: "who wins BBNaija?", rephrase: "Will a female housemate win BBNaija Season 10?", options: [
        { label: "Kellyrae", question: "Will Kellyrae win BBNaija Season 10?" }, { label: "Wanni", question: "Will Wanni win BBNaija Season 10?" }] };
      return { kind: "draft", draft: draftMarket("Will Super Eagles beat Ghana on Saturday 8pm?", { now: Math.floor(Date.now() / 1000) }) };
    };
    const b = makeBot([7], drafter);
    await b.msg("/new who wins BBNaija?");
    const r = b.replies()[0];
    expect(r.text).toContain("YES/NO only");
    expect(r.text).toContain("Will Kellyrae win BBNaija Season 10?");
    const btns = r.reply_markup.inline_keyboard.flat();
    expect(btns.map((x: any) => x.text)).toEqual(["➕ Kellyrae", "➕ Wanni", "✍️ Rephrase as one YES/NO"]);
    const wanni = btns[1].callback_data as string;
    expect(wanni).toMatch(/^opt:c_[\w-]+:1$/);

    await b.tap(wanni, MEMBER);
    expect(b.sent.filter((x) => x.method === "answerCallbackQuery").at(-1)!.payload.text).toMatch(/Only the admin/);
    expect(asked).toHaveLength(1);

    await b.tap(wanni);
    expect(asked.at(-1)).toBe("Will Wanni win BBNaija Season 10?");
    const marked = b.sent.filter((x) => x.method === "editMessageReplyMarkup").at(-1)!.payload.reply_markup.inline_keyboard.flat().map((x: any) => x.text);
    expect(marked).toContain("✅ Wanni");
    const preview = b.replies().at(-1);
    expect(preview.text).toContain("Market draft");
    expect(preview.reply_markup.inline_keyboard.flat().some((x: any) => x.text.startsWith("✅ Create"))).toBe(true);

    await b.tap(btns[2].callback_data);
    expect(asked.at(-1)).toBe("Will a female housemate win BBNaija Season 10?");
  });

  it("non-admins can't /new in a group", async () => {
    const b = makeBot();
    await b.msg("/new Will it rain in Lagos tomorrow?", MEMBER);
    expect(b.replies()[0].text).toMatch(/Only group admins/);
  });

  it("/markets shows the group's market as a simple card (no verdict) with signed group ref buttons", async () => {
    const b = makeBot();
    await linkGroupMarket(GROUP.id, M, { createdByGroup: true });
    await b.msg("/markets", MEMBER);
    const r = b.replies()[0];
    expect(r.text).not.toMatch(/Thin|Ordinary|Crowded|Overconfident/);
    expect(r.text).toMatch(/Pot \$/);
    expect(r.text).toContain("Powered by Panta");
    const urls = r.reply_markup.inline_keyboard.flat().map((x: any) => x.url).filter(Boolean);
    const buy = new URL(urls.find((u: string) => u.includes("side=yes")));
    expect(buy.searchParams.get("ref")).toBe(`g${GROUP.id}`);
    expect(buy.searchParams.get("rs")).toBe(signRef(`g${GROUP.id}`));
  });

  it("/share gives a member-attributed link and Blink", async () => {
    const b = makeBot();
    await linkGroupMarket(GROUP.id, M);
    await b.msg("/share", MEMBER);
    const t = b.replies()[0].text as string;
    expect(t).toContain(`ref=g${GROUP.id}u42`);
    expect(t).toContain("https://x.com/intent/post?");
    expect(t).not.toContain("dial.to");
    expect(t).toContain(`/blink/`);
  });

  it("/top shows group totals and who brought traders", async () => {
    const b = makeBot();
    await b.msg("/help", MEMBER); // registers Ada's name
    await recordBuy({ signature: "s1", marketId: M, wallet: "W1", side: "yes", amountUsdc: 5, ref: `g${GROUP.id}u42`, pantaUserId: "x", chatId: GROUP.id, sharerTgId: 42, sharerX: null, newToPanta: true, pantaStatus: "confirmed", attributed: true, channel: "web" });
    await b.msg("/top", MEMBER);
    const t = b.replies().at(-1).text as string;
    expect(t).toContain("1 wallet");
    expect(t).toContain("1 new to Panta");
    expect(t).toContain("Ada");
  });

  it("/link in a group points to DM; in DM it gives a signed link page", async () => {
    const b = makeBot();
    await b.msg("/link", MEMBER);
    expect(b.replies()[0].text).toContain("t.me/pantapotbot?start=link");
    await b.msg("/link", MEMBER, { id: 42, type: "private", first_name: "Ada" });
    const url = b.replies()[1].reply_markup.inline_keyboard[0][0].url as string;
    expect(verify<{ u: number; a: string }>(new URL(url).searchParams.get("t"))).toMatchObject({ u: 42, a: "link" });
  });
});

describe("practice markets in Telegram (test mode)", () => {
  const signText = (kp: Keypair, m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
  async function practiceMarket() {
    const admin = Keypair.generate(), w = admin.publicKey.toBase58();
    await upsertGroup(GROUP.id, GROUP.title);
    const d = await saveDraft(GROUP.id, 7, draftMarket("Will Tinubu win the 2027 presidential election | 31 Mar 2027", { now: Math.floor(Date.now() / 1000) }));
    const s = await startCreate(d.id, w, d.admin_id);
    return (await finishCreatePractice(d.id, s.createId, w, s.practiceMessage!, signText(admin, s.practiceMessage!))).marketId;
  }
  async function buy(id: string, kp: Keypair, side: "yes" | "no", amount: number) {
    const ref = `g${GROUP.id}`, w = kp.publicKey.toBase58();
    const s = await startBuy({ marketId: id, side, amountUsdc: amount, wallet: w, ref, rs: signRef(ref) });
    await finishBuyPractice({ orderId: s.orderId, wallet: w, marketId: id, side, amountUsdc: amount, ref, rs: signRef(ref), channel: "telegram", practiceMessage: s.practiceMessage!, practiceSignature: signText(kp, s.practiceMessage!) });
  }

  it("/markets shows the group's own practice market with its real title, labelled", async () => {
    const id = await practiceMarket();
    const b = makeBot();
    await b.msg("/markets", MEMBER);
    const r = b.replies()[0];
    expect(r.text).toContain("Practice market");
    expect(r.text).toMatch(/Tinubu/);
    expect(r.text).not.toContain("Sandbox test market");
    expect(r.reply_markup.inline_keyboard.flat().map((x: any) => x.url).join(" ")).toContain(`/m/${id}`);
  });

  it("buy alerts name the market, the pot and the split; /mine lists practice positions; /top ranks buyers", async () => {
    const id = await practiceMarket();
    const kp = Keypair.generate();
    await b0(id, kp);
    async function b0(mid: string, k: Keypair) { await buy(mid, k, "yes", 10); await buy(mid, Keypair.generate(), "no", 4); }
    const b = makeBot();
    await b.msg("/help", MEMBER); // registers Ada's name
    await linkWallet(42, kp.publicKey.toBase58());
    await notifyTick(b.bot);
    const alerts = b.sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP.id).map((s) => s.payload.text as string).filter((t) => t.includes(" bought "));
    // Batched: two buys in the same minute → one summary for the market.
    expect(alerts).toHaveLength(0);
    const sums = b.sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP.id).map((s) => s.payload.text as string).filter((t) => t.includes("new buys"));
    expect(sums).toHaveLength(1);
    expect(sums[0]).toMatch(/2 new buys<\/b> \(\$14\.00\) on <b>.*Tinubu/);
    expect(sums[0]).toMatch(/Ada .*<b>YES<\/b> \$10\.00/);
    alerts.push(sums[0]);
    // Another buy within the minute waits (no second message yet).
    await buy(id, Keypair.generate(), "no", 5);
    await notifyTick(b.bot);
    expect(b.sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === GROUP.id && /bought|new buys/.test(s.payload.text))).toHaveLength(1);
    expect(alerts.join("\n")).toMatch(/Pot now \$19\.00 · YES \d+% \/ NO \d+%/);
    expect(alerts.join("\n")).toContain("Practice market");

    await b.msg("/mine", MEMBER, { id: 42, type: "private", first_name: "Ada" });
    const mine = b.replies().at(-1).text as string;
    expect(mine).toContain("Your practice positions");
    expect(mine).toMatch(/YES \$10\.00<\/b> on .*Tinubu/);
    expect(mine).toMatch(/pays about \$\d+\.\d\d if YES wins/);
    expect(mine).toContain("Buying open until");

    await b.msg("/top", MEMBER);
    const top = b.replies().at(-1).text as string;
    expect(top).toContain("Top buyers");
    expect(top).toMatch(/1\. Ada: \$10\.00 in 1 buy/);
    expect(top).not.toContain("Website");
  });

  it("/top with no buys shows a friendly empty state", async () => {
    const b = makeBot();
    await b.msg("/top", MEMBER);
    expect(b.replies()[0].text).toContain("No buys yet. Share a market in your group to get started.");
  });
});

describe("errors never escape (webhook mode)", () => {
  it("swallows Telegram API failures and never exposes the token", async () => {
    const { createBot: mk } = await import("../src/bot");
    const bot = mk("123456:TEST_TOKEN_NOT_REAL_xxxxxxxxxxxxxxxxxxxx", { botInfo: { id: 1, is_bot: true, first_name: "Pot", username: "pantapotbot" } as any });
    bot.api.config.use(async () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" }) as any);
    const logs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    try {
      await expect(bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 5, type: "private", first_name: "x" }, from: { id: 5, is_bot: false, first_name: "x" }, text: "/help", entities: [{ type: "bot_command", offset: 0, length: 5 }] } } as any)).resolves.toBeUndefined();
    } finally { console.error = orig; }
    expect(logs.join("\n")).toContain("chat not found");
    expect(logs.join("\n")).not.toContain("TEST_TOKEN_NOT_REAL");
  });
});

describe("AI drafting in the bot", () => {
  const aiDraft = (q: string): MarketDraft => ({ ...draftMarket("Will Arsenal beat Chelsea | tomorrow 4pm"), question: q, kind: "ai", drafter: "ai", warnings: [] });
  it("/new shows the AI draft with an AI label and edit hints; a clarify answer asks back", async () => {
    const seen: string[] = [];
    const drafter: Drafter = async (text) => { seen.push(text); return /vague/.test(text) ? { kind: "clarify", question: "Which match?" } : { kind: "draft", draft: aiDraft("Will Paris Saint-Germain win the 2026–27 UEFA Champions League?") }; };
    const b = makeBot([7], drafter);
    await b.msg("/new will PSG win the champions league this season");
    const r = b.replies()[0];
    expect(seen[0]).toBe("/new will PSG win the champions league this season");
    expect(r.text).toContain("written by AI");
    expect(r.text).toContain("Paris Saint-Germain");
    expect(r.text).toContain("/edit ends");
    await b.msg("/new something vague");
    expect(b.replies().at(-1).text).toContain("🤔 Which match?");
  });

  it("/edit changes a field and refreshes the preview; others can't edit", async () => {
    const b = makeBot([7, 42], async () => ({ kind: "draft", draft: aiDraft("Will Arsenal beat Chelsea?") }));
    await b.msg("/new Arsenal beat Chelsea tomorrow");
    await b.msg("/edit question Will Arsenal beat Chelsea at the Emirates?");
    const edited = b.sent.filter((s) => s.method === "editMessageText").at(-1)!.payload;
    expect(edited.text).toContain("Updated");
    expect(edited.text).toContain("at the Emirates?");
    await b.msg("/edit sources http://bad.example");
    expect(b.replies().at(-1).text).toMatch(/https/);
    await b.msg("/edit question Hijack?", MEMBER);
    expect(b.replies().at(-1).text).toMatch(/No open draft|Only the admin/);
  });

  it("replying to the draft revises it with the AI (or applies 'field: value')", async () => {
    const calls: Array<{ text: string; previous?: MarketDraft }> = [];
    const drafter: Drafter = async (text, extra) => { calls.push({ text, previous: extra?.previous }); return { kind: "draft", draft: aiDraft(extra?.previous ? "Will Arsenal beat Chelsea by two or more goals?" : "Will Arsenal beat Chelsea?") }; };
    const b = makeBot([7], drafter);
    await b.msg("/new Arsenal beat Chelsea tomorrow");
    const previewId = b.sent.filter((s) => s.method === "sendMessage").length + 100;
    await b.msg("make it win by two or more goals", ADMIN, GROUP, previewId);
    expect(calls[1].previous?.question).toBe("Will Arsenal beat Chelsea?");
    expect(b.sent.filter((s) => s.method === "editMessageText").at(-1)!.payload.text).toContain("two or more goals");
    await b.msg("title: Arsenal by 2+", ADMIN, GROUP, previewId);
    expect(calls).toHaveLength(2); // field edit didn't call the AI
  });
});
