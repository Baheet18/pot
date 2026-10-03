import { M } from "../../../packages/server/test/env";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot";
import { getDraft, linkGroupMarket, recordBuy, resetDbForTests, signRef, verify } from "@pot/server";

type Sent = { method: string; payload: any };
type U = { id: number; is_bot: boolean; first_name: string; username?: string };
const GROUP = { id: -100500, type: "supergroup" as const, title: "Naija Ballers" };
const ADMIN: U = { id: 7, is_bot: false, first_name: "Baheet", username: "baheet_" };
const MEMBER: U = { id: 42, is_bot: false, first_name: "Ada" };

function makeBot(adminIds: number[] = [7]) {
  const sent: Sent[] = [];
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
  const tap = (data: string, from = ADMIN) => bot.handleUpdate({
    update_id: uid++,
    callback_query: { id: String(uid), from, chat_instance: "x", data, message: { message_id: 1, date: 0, chat: GROUP, text: "draft" } },
  } as any);
  const replies = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload);
  return { bot, sent, msg, tap, replies };
}

beforeEach(() => resetDbForTests(":memory:"));

describe("Pot bot", () => {
  it("/new drafts a market with Create/Cancel buttons; the create button gives a signed link", async () => {
    const b = makeBot();
    await b.msg("/new Will Super Eagles beat Ghana on Saturday 8pm?");
    const r = b.replies()[0];
    expect(r.text).toContain("Market draft");
    expect(r.text).toContain("Sandbox");
    const btns = r.reply_markup.inline_keyboard.flat();
    const create = btns.find((x: any) => x.text.startsWith("✅ Create"));
    expect(create).toBeTruthy();
    const draftId = create.callback_data.split(":")[1];
    expect(getDraft(draftId)?.chat_id).toBe(GROUP.id);

    await b.tap(`create:${draftId}`, MEMBER); // not the drafting admin
    expect(b.sent.find((s) => s.method === "answerCallbackQuery")!.payload.text).toMatch(/Only the admin/);

    await b.tap(`create:${draftId}`);
    const pay = b.replies().at(-1);
    const url: string = pay.reply_markup.inline_keyboard[0][0].url;
    expect(url).toMatch(new RegExp(`^https://pot.example/create/${draftId}\\?t=`));
    expect(verify<{ d: string }>(new URL(url).searchParams.get("t"))?.d).toBe(draftId);
  });

  it("non-admins can't /new in a group", async () => {
    const b = makeBot();
    await b.msg("/new Will it rain in Lagos tomorrow?", MEMBER);
    expect(b.replies()[0].text).toMatch(/Only group admins/);
  });

  it("/markets shows the group's market as a card with verdict and signed group ref buttons", async () => {
    const b = makeBot();
    linkGroupMarket(GROUP.id, M, { createdByGroup: true });
    await b.msg("/markets", MEMBER);
    const r = b.replies()[0];
    expect(r.text).toMatch(/Thin|Ordinary|Crowded|Overconfident/);
    expect(r.text).toContain("Powered by Panta");
    const urls = r.reply_markup.inline_keyboard.flat().map((x: any) => x.url).filter(Boolean);
    const buy = new URL(urls.find((u: string) => u.includes("side=yes")));
    expect(buy.searchParams.get("ref")).toBe(`g${GROUP.id}`);
    expect(buy.searchParams.get("rs")).toBe(signRef(`g${GROUP.id}`));
  });

  it("/share gives a member-attributed link and Blink", async () => {
    const b = makeBot();
    linkGroupMarket(GROUP.id, M);
    await b.msg("/share", MEMBER);
    const t = b.replies()[0].text as string;
    expect(t).toContain(`ref=g${GROUP.id}u42`);
    expect(t).toContain("dial.to");
  });

  it("/top shows group totals and who brought traders", async () => {
    const b = makeBot();
    await b.msg("/help", MEMBER); // registers Ada's name
    recordBuy({ signature: "s1", marketId: M, wallet: "W1", side: "yes", amountUsdc: 5, ref: `g${GROUP.id}u42`, pantaUserId: "x", chatId: GROUP.id, sharerTgId: 42, sharerX: null, newToPanta: true, pantaStatus: "confirmed", attributed: true, channel: "web" });
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
