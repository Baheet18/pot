import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { esc, findDeadline, fmtWat, formatReceiptHtml, renderCard, validateDraft, type Card, type Ref, type MarketDraft } from "@pot/core";
import {
  allGroupMarkets, getDraft, getMarketView, getPositions, groupLeaderboard, groupMarkets, isMarketId, isPublicHttps, linkGroupMarket,
  marketUrl, practicePositions, topPeople, walletOwnerName, claimNotify, claimPhase, memberName, saveDraft, setGroupMarketState, sign, SANDBOX, unnotifiedBuys, updateDraft, upsertGroup, upsertMember,
  walletsFor, consumeNameClaim, receiptFor, saveChoice, getChoice, updateChoice, type DraftChoice, buildReceipt, claimReceipt, setReceiptMessage, releaseReceipt, groupsForMarket, practiceMarketsForChat, settlePracticeMarket, blinkPreviewFor, shareTextFor, xShareFor, WEB_URL, listOpenViews, type MarketView, draftWithAI, applyEdit, draftByMessage, latestOpenDraft, EDIT_FIELDS, type DraftResult,
} from "@pot/server";

/**
 * Pot Telegram bot. Built as a factory so tests can drive it with fake updates and a fake API.
 * Buttons use URLs only when the web app has a public https URL (Telegram rejects localhost buttons);
 * otherwise links are written into the message text.
 */
export const COMMANDS = [
  { command: "new", description: "Draft a market: /new Will Nigeria beat Benin Fri 5pm?" },
  { command: "edit", description: "Tweak your draft: /edit ends 31 May 2027 23:00" },
  { command: "markets", description: "Markets in this group" },
  { command: "share", description: "Your personal share links for a market" },
  { command: "top", description: "Leaderboard: who brought new traders" },
  { command: "mine", description: "Your positions and winnings to claim" },
  { command: "link", description: "Link your Solana wallet" },
  { command: "admin", description: "Creator dashboard (group admins)" },
  ...(SANDBOX ? [{ command: "settle", description: "Admins: settle a practice market: /settle yes" }] : []),
  { command: "help", description: "How Pot works" },
];

/** Short, token-free error text for logs. */
export function safeErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, "[token]").slice(0, 300);
}

const shortW = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const usd = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`);
const SANDBOX_NOTE = SANDBOX ? "\n\n🧪 <i>Practice mode: no real money moves.</i>" : "";

function isGroup(ctx: Context) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

async function isAdmin(ctx: Context): Promise<boolean> {
  if (!isGroup(ctx)) return true; // DMs: the user is their own admin (handy for testing)
  if (!ctx.from) return false;
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === "creator" || m.status === "administrator";
  } catch {
    return false;
  }
}

/** Turn a Card into Telegram message options (URL buttons only on public https). */
export function cardMessage(card: Card): { text: string; reply_markup?: InlineKeyboard } {
  if (isPublicHttps()) {
    const kb = new InlineKeyboard();
    card.keyboard.forEach((row, i) => {
      row.forEach((b) => (b.url ? kb.url(b.text, b.url) : kb.text(b.text, b.callback ?? "noop")));
      if (i < card.keyboard.length - 1) kb.row();
    });
    return { text: card.html, reply_markup: kb };
  }
  const links = card.keyboard.flat().filter((b) => b.url).map((b) => `${b.text}: ${esc(b.url!)}`);
  return { text: `${card.html}\n\n${links.join("\n")}` };
}

export function cardFor(view: MarketView, ref: Ref): Card {
  const id = view.market.id;
  return renderCard(view.market, view.stats, view.payout,
    { buyYes: marketUrl(id, ref, "yes"), buyNo: marketUrl(id, ref, "no"), details: marketUrl(id, ref), blink: xShareFor(id, ref, shareTextFor(view)) },
    { now: Math.floor(Date.now() / 1000), sandbox: view.sandbox, practice: view.practice, buyable: view.buyable });
}

export function draftPreview(d: MarketDraft, problems: string[]): string {
  const lines = [
    d.drafter === "rules" ? "📝 <b>Market draft</b> · 🛠 <i>basic drafter (AI unavailable)</i>" : "📝 <b>Market draft</b> · 🤖 <i>written by AI, please check it</i>",
    `<b>Question:</b> ${esc(d.question)}`,
    `<b>Rule:</b> ${esc(d.resolutionRule)}`,
    `<b>Sources:</b> ${d.sourcesOfTruth.map(esc).join(", ")}`,
    d.timing === "event" && d.eventStartTime
      ? `<b>Kick-off / start:</b> ${esc(fmtWat(d.eventStartTime))}\n<b>Buying closes:</b> ${esc(fmtWat(d.startTime))}${d.startTime === d.eventStartTime ? " (at kick-off)" : ""}`
      : `<b>Buying closes:</b> ${esc(fmtWat(d.startTime))}`,
    `<b>Event ends:</b> ${esc(fmtWat(d.endTime))}`,
    `<b>Result by:</b> ${esc(fmtWat(d.resolutionTime))}`,
    `<b>Type:</b> ${d.marketType}${d.eventInProgress ? " (event in progress)" : ""} · fee $${d.creationFeeUsdc} · category ${d.category} · region ${esc(d.region)}`,
    `<b>You earn:</b> up to 20% of the pot as creator royalty (less if 90%+ of traders pick one side).`,
  ];
  if (d.warnings.length) lines.push("", "⚠️ " + d.warnings.map(esc).join("\n⚠️ "));
  if (problems.length) lines.push("", "❌ <b>Can't create yet:</b> " + problems.map(esc).join("; "));
  lines.push("", "<i>Want changes? Reply to this message with what to change (e.g. \"make the deadline 30 June 2027\"), or use <code>/edit ends 31 May 2027 23:00</code>. Fields: " + EDIT_FIELDS.join(", ") + ".</i>");
  return lines.join("\n") + SANDBOX_NOTE;
}

export function choiceText(c: DraftChoice): string {
  return [
    `🔀 <b>Panta markets are YES/NO only</b>, and "${esc(c.question.replace(/^\/new(@\w+)?\s*/i, "").slice(0, 120))}" has several possible answers.`,
    "",
    "Pick which YES/NO markets to draft (tap more than one if you like):",
    ...c.options.map((o) => `• ${esc(o.question)}`),
    c.rephrase ? `\nOr make it one question: <i>${esc(c.rephrase)}</i>` : "\nOr send /new with your own YES/NO question.",
  ].join("\n");
}
export function choiceKeyboard(c: DraftChoice): InlineKeyboard {
  const kb = new InlineKeyboard();
  c.options.forEach((o, i) => kb.text(`${o.used ? "✅" : "➕"} ${o.label}`, `opt:${c.id}:${i}`).row());
  if (c.rephrase) kb.text("✍️ Rephrase as one YES/NO", `opt:${c.id}:r`);
  return kb;
}

const draftKeyboard = (id: string, d: MarketDraft, problems: string[]) => {
  const kb = new InlineKeyboard();
  if (!problems.length) kb.text(`✅ Create ($${d.creationFeeUsdc})`, `create:${id}`);
  return kb.text("❌ Cancel", `cancel:${id}`);
};

export type Drafter = (text: string, extra?: { previous?: MarketDraft; instruction?: string }) => Promise<DraftResult>;

export function createBot(token: string, opts: { botInfo?: UserFromGetMe; drafter?: Drafter } = {}) {
  const drafter: Drafter = opts.drafter ?? ((text, extra) => draftWithAI(text, extra));
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const botUser = () => bot.botInfo?.username ?? "pantapotbot";

  // Error boundary first: in webhook mode grammY rethrows middleware errors, and its error objects carry the
  // full context (including the API token). Never let them escape or get logged; log only a short message.
  bot.use(async (_ctx, next) => {
    try {
      await next();
    } catch (e) {
      console.error("[bot] handler error:", safeErr(e));
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) await upsertMember(ctx.from.id, ctx.from.username ? `@${ctx.from.username}` : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "));
    if (isGroup(ctx) && ctx.chat) await upsertGroup(ctx.chat.id, "title" in ctx.chat ? ctx.chat.title : undefined);
    await next();
  });

  const help = [
    "🏺 <b>Pot</b>: prediction markets for your group, powered by Panta.",
    "",
    "1) A group admin types <code>/new Will Nigeria beat Benin Fri 5pm?</code>. I draft a clear rule and sources.",
    SANDBOX
      ? "2) The admin taps Create and signs a free message in Phantom. Right now this is a practice market: no fee is charged (live markets cost $20 breaking / $50 standard)."
      : "2) The admin taps Create and pays the Panta fee ($20 breaking / $50 standard) from their wallet. The admin earns up to 20% of the pot.",
    SANDBOX
      ? "3) Members tap Buy YES / Buy NO and sign a free message (no real money). I post the pot as it grows, so you can see how a real market would move."
      : "3) Members tap Buy YES / Buy NO and sign in Phantom. I post the pot as it grows, then the result and claim links.",
    "",
    "When a market resolves I post a receipt: the result, the final pot, and who won or lost how much.",
    SANDBOX ? "Practice markets have no oracle, so the group admin settles them after the event: <code>/settle yes</code> or <code>/settle no</code>." : "",
    "Commands: /new /markets /share /top /mine /link /admin" + (SANDBOX ? " /settle" : ""),
  ].join("\n");

  bot.command(["start", "help"], async (ctx) => {
    const payload = ctx.match?.toString().trim();
    if (payload === "link" && ctx.from) return sendLink(ctx);
    if (payload?.startsWith("n_") && ctx.from && !isGroup(ctx)) {
      // "Put my Telegram name on it" after a website/Blink buy.
      const c = await consumeNameClaim(payload, ctx.from.id);
      if (!c) return ctx.reply("That link was already used or has expired. You can still link your wallet with /link.");
      const name = ctx.from.username ? `@${ctx.from.username}` : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
      if (c.marketId) await rerenderReceipts(ctx.api, c.marketId).catch(() => undefined);
      return ctx.reply(`✅ Done. Your buy now shows as <b>${esc(name)}</b> in group alerts and receipts, and wallet ${shortW(c.wallet)} is linked, so /mine shows your positions.`, { parse_mode: "HTML" });
    }
    if (payload?.startsWith("m_") && isMarketId(payload.slice(2))) return sendCard(ctx, payload.slice(2), memberRef(ctx));
    await ctx.reply(help + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("new", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isAdmin(ctx))) return ctx.reply("Only group admins can create markets. Ask an admin, or DM me to try it yourself.");
    const text = ctx.message?.text ?? "";
    if (!text.replace(/^\/new(@\w+)?/i, "").trim()) return ctx.reply("Tell me the market idea, e.g. /new Will PSG win the Champions League this season?");
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    let r: DraftResult;
    try {
      r = await drafter(text);
    } catch (e) {
      return ctx.reply((e as Error).message);
    }
    await showResult(ctx, r);
  });

  /** Reply to a drafter result: a draft preview, a clarifying question, a polite refusal, or YES/NO options to pick. */
  async function showResult(ctx: Context, r: DraftResult) {
    if (!ctx.chat || !ctx.from) return;
    if (r.kind === "clarify") return ctx.reply(`🤔 ${r.question}\n\nSend /new again with a bit more detail.`);
    if (r.kind === "refuse") return ctx.reply(`${r.message}\n\n💡 ${r.suggestion}`);
    if (r.kind === "multi") {
      const c = await saveChoice(ctx.chat.id, ctx.from.id, { question: r.question, options: r.options, rephrase: r.rephrase });
      return ctx.reply(choiceText(c), { parse_mode: "HTML", reply_markup: choiceKeyboard(c) });
    }
    const draft = r.draft;
    const problems = validateDraft(draft);
    const row = await saveDraft(ctx.chat.id, ctx.from.id, draft);
    const msg = await ctx.reply(draftPreview(draft, problems), { parse_mode: "HTML", reply_markup: draftKeyboard(row.id, draft, problems), link_preview_options: { is_disabled: true } });
    await updateDraft(row.id, { message_id: msg.message_id });
  }

  // Multi-outcome: the drafting admin taps which YES/NO markets to draft (one tap per market), or the one-question rephrase.
  bot.callbackQuery(/^opt:(c_[\w-]+):(\d+|r)$/, async (ctx) => {
    const c = await getChoice(ctx.match[1]);
    if (!c) return ctx.answerCallbackQuery({ text: "That list expired. Send /new again." });
    if (c.admin_id !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Only the admin who asked can pick." });
    const pick = ctx.match[2];
    const opt = pick === "r" ? (c.rephrase ? { label: "Rephrased", question: c.rephrase } : null) : c.options[Number(pick)];
    if (!opt) return ctx.answerCallbackQuery({ text: "Option not found." });
    await ctx.answerCallbackQuery({ text: `Drafting: ${opt.label}` });
    if (pick !== "r") {
      c.options[Number(pick)].used = true;
      await updateChoice(c);
      await ctx.editMessageReplyMarkup({ reply_markup: choiceKeyboard(c) }).catch(() => undefined);
    }
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    let r: DraftResult;
    try {
      r = await drafter(opt.question);
    } catch (e) {
      return ctx.reply((e as Error).message);
    }
    if (r.kind === "multi") return ctx.reply("I couldn't turn that into a single YES/NO market. Try /new with a YES/NO question.");
    await showResult(ctx, r);
  });

  /** Save an edited draft and refresh its preview (edit in place; send a new one if that fails). */
  async function showEdited(ctx: Context, rowId: string, chatId: number, messageId: number | null, d: MarketDraft) {
    const problems = validateDraft(d);
    await updateDraft(rowId, { draft: d, status: "draft" });
    const text = "✏️ <b>Updated.</b>\n" + draftPreview(d, problems);
    const extra = { parse_mode: "HTML" as const, reply_markup: draftKeyboard(rowId, d, problems), link_preview_options: { is_disabled: true } };
    if (messageId) {
      try { await ctx.api.editMessageText(chatId, Number(messageId), text, extra); return; } catch { /* fall through: send fresh */ }
    }
    const m = await ctx.reply(text, extra);
    await updateDraft(rowId, { message_id: m.message_id });
  }

  async function editableDraft(ctx: Context) {
    if (!ctx.chat || !ctx.from) return null;
    const replyTo = ctx.message?.reply_to_message?.message_id;
    const row = replyTo ? await draftByMessage(ctx.chat.id, replyTo) : await latestOpenDraft(ctx.chat.id, ctx.from.id);
    if (!row) return null;
    if (Number(row.admin_id) !== ctx.from.id) { await ctx.reply("Only the admin who drafted this can change it."); return "denied" as const; }
    if (row.status === "created" || row.status === "cancelled") { await ctx.reply(`That draft was already ${row.status}. Start a new one with /new.`); return "denied" as const; }
    return row;
  }

  const FIELD_RE = new RegExp(`^(${EDIT_FIELDS.join("|")}|close|end|start|resolution)\\s*[:=]?\\s+([\\s\\S]+)$`, "i");

  bot.command("edit", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const arg = ctx.match?.toString().trim() ?? "";
    const m = FIELD_RE.exec(arg);
    if (!m) return ctx.reply(`Usage: /edit <field> <value>\nFields: ${EDIT_FIELDS.join(", ")}\nExamples:\n/edit ends 31 May 2027 23:00\n/edit sources https://www.uefa.com https://www.bbc.com/sport/football\nOr reply to the draft with the change in plain words.`);
    const row = await editableDraft(ctx);
    if (row === "denied") return;
    if (!row) return ctx.reply("No open draft to edit. Start one with /new.");
    try {
      const now = Math.floor(Date.now() / 1000);
      const d = applyEdit(row.draft, m[1], m[2], now, (s) => findDeadline(s, now)?.unix ?? null);
      await showEdited(ctx, row.id, ctx.chat.id, row.message_id, d);
    } catch (e) {
      await ctx.reply((e as Error).message);
    }
  });

  bot.callbackQuery(/^cancel:(d_[\w-]+)$/, async (ctx) => {
    const row = await getDraft(ctx.match[1]);
    if (!row || row.admin_id !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Only the admin who drafted this can cancel it." });
    if (row.status !== "created") await updateDraft(row.id, { status: "cancelled" });
    await ctx.answerCallbackQuery({ text: "Draft cancelled" });
    await ctx.editMessageText("❌ Draft cancelled.");
  });

  bot.callbackQuery(/^create:(d_[\w-]+)$/, async (ctx) => {
    const row = await getDraft(ctx.match[1]);
    if (!row) return ctx.answerCallbackQuery({ text: "Draft not found." });
    if (row.admin_id !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Only the admin who drafted this can create it." });
    if (row.status === "created") return ctx.answerCallbackQuery({ text: "Already created." });
    await updateDraft(row.id, { status: "confirmed" });
    const t = sign({ d: row.id, u: ctx.from.id }, 2 * 3600);
    const url = `${WEB_URL}/create/${row.id}?t=${t}`;
    await ctx.answerCallbackQuery({ text: "Open the link to sign and pay." });
    const text = `💳 <b>Sign & pay to create</b>\nOpen this in Phantom, check the details, then sign. The fee is $${row.draft.creationFeeUsdc} USDC and you become the creator (royalty goes to your wallet).${SANDBOX ? "\n🧪 Sandbox: no real payment, you can simulate." : ""}`;
    if (isPublicHttps()) await ctx.reply(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("✍️ Sign & pay", url) });
    else await ctx.reply(`${text}\n\n${esc(url)}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  async function sendCard(ctx: Context, marketId: string, ref: Ref) {
    try {
      const view = await getMarketView(marketId);
      const m = cardMessage(cardFor(view, ref));
      return await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.reply_markup, link_preview_options: { is_disabled: true } });
    } catch {
      return ctx.reply("Couldn't load that market from Panta right now. Try again in a minute.");
    }
  }
  const groupRef = (ctx: Context): Ref => (isGroup(ctx) && ctx.chat ? { kind: "group", chatId: ctx.chat.id } : { kind: "web" });
  const memberRef = (ctx: Context): Ref => (isGroup(ctx) && ctx.chat && ctx.from ? { kind: "member", chatId: ctx.chat.id, userId: ctx.from.id } : { kind: "web" });

  bot.command("markets", async (ctx) => {
    if (!ctx.chat) return;
    const rows = isGroup(ctx) ? (await groupMarkets(ctx.chat.id)).slice(0, 5) : [];
    if (rows.length) {
      for (const r of rows) await sendCard(ctx, r.market_id, groupRef(ctx));
      return;
    }
    const open = (await listOpenViews(8).catch(() => [])).slice(0, 3);
    if (!open.length) return ctx.reply("No open markets yet. An admin can start one with /new.");
    await ctx.reply(SANDBOX
      ? `No markets in this chat yet. An admin can start one with /new. Meanwhile, here are practice markets from other groups:`
      : `No markets in this chat yet. Here are open Panta markets (admins: <code>/post &lt;id&gt;</code> to pin one here):`, { parse_mode: "HTML" });
    for (const v of open) {
      const m = cardMessage(cardFor(v, groupRef(ctx)));
      await ctx.reply(`${m.text}\n<code>${v.market.id}</code>`, { parse_mode: "HTML", reply_markup: m.reply_markup, link_preview_options: { is_disabled: true } });
    }
  });

  bot.command("post", async (ctx) => {
    if (!ctx.chat) return;
    const id = ctx.match?.toString().trim();
    if (!id || !isMarketId(id)) return ctx.reply("Usage: /post <marketId>");
    if (!(await isAdmin(ctx))) return ctx.reply("Only group admins can post markets.");
    const msg = await sendCard(ctx, id, groupRef(ctx));
    if (isGroup(ctx) && msg && "message_id" in msg) await linkGroupMarket(ctx.chat.id, id, { cardMessageId: msg.message_id });
  });

  bot.command("market", async (ctx) => {
    const id = ctx.match?.toString().trim();
    if (!id || !isMarketId(id)) return ctx.reply("Usage: /market <marketId>");
    await sendCard(ctx, id, groupRef(ctx));
  });

  bot.command("share", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    let id = ctx.match?.toString().trim();
    if (!id && isGroup(ctx)) id = (await groupMarkets(ctx.chat.id))[0]?.market_id;
    if (!id || !isMarketId(id)) return ctx.reply("Usage: /share <marketId> (or use it in a group with a market)");
    const ref = memberRef(ctx);
    const view = await getMarketView(id).catch(() => null);
    const text = view ? shareTextFor(view) : "Pick a side on Pot:";
    const lines = [
      `🔗 <b>Your share links</b> (buys through these count for you on /top)`,
      `Telegram / WhatsApp: ${esc(marketUrl(id, ref))}`,
      `Post on X: ${esc(xShareFor(id, ref, text))}`,
      `<i>On X, people with Phantom or Backpack see buy buttons right in the post (a Blink); everyone else sees a preview card that opens the market.</i>`,
      `Preview the Blink: ${esc(blinkPreviewFor(id, ref))}`,
    ];
    await ctx.reply(lines.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("top", async (ctx) => {
    if (!ctx.chat) return;
    if (!isGroup(ctx)) return ctx.reply("Use /top in a group to see who's buying and who brought new traders.");
    const b = await groupLeaderboard(ctx.chat.id);
    const lines = [`🏆 <b>Pot leaderboard</b>`];
    if (!b.totals.buys) {
      lines.push("", "No buys yet. Share a market in your group to get started.", "Tip: /share gives you your own link, so buys through it count for you here.");
      return ctx.reply(lines.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML" });
    }
    const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    lines.push(`This group: ${pl(b.totals.wallets, "wallet")} · ${usd(b.totals.volumeUsdc)} in ${pl(b.totals.buys, "buy")}${b.totals.newToPanta ? ` · ${b.totals.newToPanta} new to Panta` : ""}`);
    const people = (await topPeople(10, ctx.chat.id)).filter((p) => p.buys > 0);
    if (people.length) {
      lines.push("", "<b>Top buyers</b>");
      for (const [i, p] of people.entries()) lines.push(`${i + 1}. ${esc(p.name)}: ${usd(p.volume)} in ${pl(p.buys, "buy")}`);
    }
    if (b.members.length) {
      lines.push("", "<b>Brought new traders</b> (via /share links)");
      for (const [i, m] of b.members.entries()) lines.push(`${i + 1}. ${esc((await memberName(m.sharer_tg_id)) ?? "a member")}: ${pl(m.new_wallets, "new wallet")}, ${usd(m.volume)}`);
    } else lines.push("", "Nobody has brought a trader through a /share link yet. Use /share to get yours.");
    await ctx.reply(lines.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML" });
  });

  async function sendLink(ctx: Context) {
    if (!ctx.from) return;
    const t = sign({ u: ctx.from.id, a: "link" }, 3600);
    const url = `${WEB_URL}/link?t=${t}`;
    const text = "🔐 Link your Solana wallet so /mine can show your positions. You sign a free message (no transaction, no fee).";
    if (isPublicHttps()) await ctx.reply(text, { reply_markup: new InlineKeyboard().url("Link wallet", url) });
    else await ctx.reply(`${text}\n\n${url}`, { link_preview_options: { is_disabled: true } });
  }

  bot.command("link", async (ctx) => {
    if (isGroup(ctx)) return ctx.reply(`DM me to link your wallet privately: https://t.me/${botUser()}?start=link`);
    await sendLink(ctx);
  });

  bot.command("mine", async (ctx) => {
    if (!ctx.from) return;
    if (isGroup(ctx)) return ctx.reply(`Your positions are private. DM me: https://t.me/${botUser()}?start=link`);
    const wallets = await walletsFor(ctx.from.id);
    if (!wallets.length) return sendLink(ctx);
    if (SANDBOX) {
      const pos = await practicePositions(wallets).catch(() => null);
      const out: string[] = ["📒 <b>Your practice positions</b>"];
      if (!pos) out.push("", "Couldn't load your positions right now. Try again in a minute.");
      else if (!pos.length) out.push("", "No practice buys yet. Open a market card in your group and tap a Buy button.", `Linked wallet${wallets.length === 1 ? "" : "s"}: ${wallets.map(shortW).join(", ")}`);
      for (const p of (pos ?? []).slice(0, 15)) {
        out.push("", `• <b>${p.side.toUpperCase()} ${usd(p.amountUsdc)}</b> on ${esc(p.title)}`,
          p.result
            ? `   Result ${p.result.toUpperCase()}: ${p.outcome === "even" ? `🤝 everyone picked ${p.side.toUpperCase()}, so no losing side: about ${usd(p.payout)} back (not a win or a loss)` : p.outcome === "won" ? `✅ won, pays about ${usd(p.payout)}` : "❌ lost"}`
            : `   ${p.shares.toFixed(2)} shares · pays about ${usd(p.paysIfWin)} if ${p.side.toUpperCase()} wins`,
          `   ${p.result ? "Settled" : p.open ? `Buying open until ${fmtWat(p.closes)}` : "Buying closed, waiting for the result"} · ${esc(`${WEB_URL}/m/${p.marketId}`)}`);
      }
      return ctx.reply(out.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    }
    const out: string[] = ["📒 <b>Your positions</b>"];
    for (const w of wallets) {
      const pos = await getPositions(w).catch(() => null);
      out.push(`\n<b>${shortW(w)}</b>`);
      if (!pos) { out.push("Couldn't load positions right now."); continue; }
      if (!pos.length) { out.push("No positions yet."); continue; }
      for (const p of pos.slice(0, 15)) {
        const claim = p.claimable && !p.claimed ? ` → claim: ${esc(`${WEB_URL}/claim/${p.marketId}?kind=win&w=${w}`)}` : p.claimed ? " (claimed)" : "";
        const res = p.outcome ? (p.outcome === p.side ? " ✅ won" : " ❌ lost") : "";
        out.push(`• ${p.side.toUpperCase()} ${Number(p.shares).toFixed(2)} sh · ${p.phase}${res} · <code>${p.marketId.slice(0, 8)}…</code>${claim}`);
      }
    }
    await ctx.reply(out.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("admin", async (ctx) => {
    if (!ctx.chat) return;
    if (!(await isAdmin(ctx))) return ctx.reply("Only group admins can open the creator dashboard.");
    const rows = (await groupMarkets(ctx.chat.id)).filter((r) => r.created_by_group);
    if (!rows.length) return ctx.reply("This group hasn't created a market yet. Start one with /new.");
    const out = ["🧾 <b>Creator dashboard</b>"];
    let total = 0;
    for (const r of rows.slice(0, 10)) {
      const v = await getMarketView(r.market_id).catch(() => null);
      if (!v) { out.push(`• <code>${r.market_id.slice(0, 8)}…</code>: couldn't load`); continue; }
      total += v.royalty.estimatedUsdc;
      const claim = v.royalty.claimableNow && r.creator_wallet ? `\n   claim: ${esc(`${WEB_URL}/claim/${r.market_id}?kind=creator&w=${r.creator_wallet}`)}` : "";
      out.push(`• <b>${esc(v.market.title)}</b>\n   pot ${usd(v.royalty.poolUsdc)} · royalty ${(v.royalty.royaltyBps / 100).toFixed(0)}% ≈ <b>${usd(v.royalty.estimatedUsdc)}</b> · ${v.royalty.note}${claim}`);
    }
    out.push("", `Estimated royalties: <b>${usd(total)}</b> (estimate; Panta sets the final number).`);
    await ctx.reply(out.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("settle", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!SANDBOX) return ctx.reply("Live markets are settled by Panta's resolver. I post the receipt here automatically when the result is in.");
    if (!isGroup(ctx)) return ctx.reply("Use /settle in the group that created the practice market.");
    if (!(await isAdmin(ctx))) return ctx.reply("Only group admins can settle a practice market.");
    const args = (ctx.match?.toString().trim() ?? "").split(/\s+/).filter(Boolean);
    const outcome = args.map((a) => a.toLowerCase()).find((a) => a === "yes" || a === "no") as "yes" | "no" | undefined;
    const idArg = args.find((a) => !/^(yes|no)$/i.test(a));
    if (!outcome) return ctx.reply("Usage: /settle yes  or  /settle no\nIf the group has more than one open practice market: /settle <id> yes");
    const mine = await practiceMarketsForChat(ctx.chat.id);
    let target: (typeof mine)[number] | undefined;
    if (idArg) {
      target = mine.find((m) => m.id === idArg || (idArg.length >= 6 && m.id.startsWith(idArg)));
      if (!target) return ctx.reply("I can't find that practice market in this group. Only the group that created a market can settle it.");
    } else {
      const open = mine.filter((m) => !m.outcome);
      if (!open.length) return ctx.reply("This group has no unsettled practice markets.");
      if (open.length > 1) return ctx.reply(["Which one? Send the id with the result:", ...open.slice(0, 8).map((m) => `• <code>/settle ${m.id.slice(0, 8)} ${outcome}</code>: ${esc(m.draft.question)}`)].join("\n"), { parse_mode: "HTML" });
      target = open[0];
    }
    if (target.outcome) return ctx.reply(`Already settled: ${target.outcome.toUpperCase()}. Each market gets one result and one receipt.`);
    const now = Math.floor(Date.now() / 1000);
    if (now < target.draft.startTime) return ctx.reply(`Buying is still open until ${fmtWat(target.draft.startTime)}. Settle it after the event, using the rule's source.`);
    const res = await settlePracticeMarket(target.id, outcome, ctx.from.id);
    if (res.already) return ctx.reply(`Already settled: ${res.outcome.toUpperCase()}.`);
    const view = await getMarketView(target.id);
    const groups = new Map<number, number>((await groupsForMarket(target.id)).map((g) => [Number(g.chat_id), g.created_by_group]));
    groups.set(ctx.chat.id, 1); // always post in the settling group, even with no buys
    for (const [chatId, created] of groups) await postReceipt(ctx.api, chatId, view, { force: !!created });
  });

  bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

  // Reply to a draft preview with a change in plain words ("make the deadline 30 June 2027") or "field: value".
  bot.on("message:text", async (ctx, next) => {
    const reply = ctx.message.reply_to_message;
    if (!reply || reply.from?.id !== ctx.me.id || ctx.message.text.startsWith("/")) return next();
    const found = await draftByMessage(ctx.chat.id, reply.message_id);
    if (!found) return next();
    const row = await editableDraft(ctx);
    if (!row || row === "denied") return;
    const text = ctx.message.text.trim();
    const now = Math.floor(Date.now() / 1000);
    try {
      const m = FIELD_RE.exec(text);
      if (m) return await showEdited(ctx, row.id, ctx.chat.id, row.message_id, applyEdit(row.draft, m[1], m[2], now, (s) => findDeadline(s, now)?.unix ?? null));
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const r = await drafter(text, { previous: row.draft, instruction: text });
      if (r.kind === "clarify") return ctx.reply(`🤔 ${r.question}`);
      if (r.kind === "refuse") return ctx.reply(`${r.message}\n\n💡 ${r.suggestion}`);
      if (r.kind === "multi") return ctx.reply("Panta markets are YES/NO only. Ask for one YES/NO question.");
      await showEdited(ctx, row.id, ctx.chat.id, row.message_id, r.draft);
    } catch (e) {
      await ctx.reply((e as Error).message);
    }
  });
  bot.catch((err) => console.error("[bot] handler error:", safeErr(err.error)));
  return bot;
}

/** Posts new buys and phase changes into groups. Runs on an interval in main.ts. */
export async function notifyTick(bot: Bot) {
  for (const b of await unnotifiedBuys()) {
    if (!(await claimNotify(b.signature))) continue; // another instance already took it
    try {
      const v = await getMarketView(b.market_id).catch(() => null);
      const title = v ? v.market.title : b.market_id.slice(0, 8) + "…";
      const owner = await walletOwnerName(b.wallet).catch(() => null);
      const buyer = owner ? `${esc(owner)} (${shortW(b.wallet)})` : shortW(b.wallet);
      const who = b.sharer_tg_id ? ` via ${esc(await memberName(b.sharer_tg_id) ?? "a member")}'s link` : "";
      const fresh = b.new_to_panta ? "\n🎉 First ever Panta trade for this wallet" : b.new_to_pot ? "\n👋 First Pot buy for this wallet" : "";
      const yes = v?.stats.yesSplit;
      const state = v ? `\nPot now ${usd(v.market.totalVolumeUsdc || v.market.volumeUsdc)}${yes != null ? ` · YES ${Math.round(yes * 100)}% / NO ${100 - Math.round(yes * 100)}%` : ""}` : "";
      const tag = v?.practice ? "\n🧪 <i>Practice market: no real money</i>" : SANDBOX ? " 🧪" : "";
      const kb = v?.buyable ? new InlineKeyboard().url("Buy too", marketUrl(b.market_id, { kind: "group", chatId: Number(b.chat_id) })) : undefined;
      await bot.api.sendMessage(b.chat_id!, `${b.side === "yes" ? "🟩" : "🟥"} ${buyer} bought <b>${b.side.toUpperCase()}</b> ${usd(b.amount_usdc)} on <b>${esc(title)}</b>${who}${state}${fresh}${tag}`, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
    } catch (e) {
      console.error("[bot] notify failed:", safeErr(e));
    }
  }
}

/**
 * Posts one settlement receipt per market per group. Idempotent: the receipts table claim (market, chat) wins once;
 * if sending fails the claim is released so a later tick retries. Groups with no buys only get one if they created it.
 */
export async function postReceipt(api: Bot["api"], chatId: number, view: MarketView, opts: { force?: boolean } = {}): Promise<"posted" | "already" | "skipped" | "failed"> {
  const id = view.market.id;
  try {
    const receipt = await buildReceipt(view, { chatId });
    if (!receipt.people.length && !opts.force) {
      await setGroupMarketState(chatId, id, { settled_notified: 1 });
      return "skipped";
    }
    if (!(await claimReceipt(id, chatId))) return "already";
    try {
      const kb = isPublicHttps() ? new InlineKeyboard().url("Full receipt", marketUrl(id, { kind: "group", chatId })) : undefined;
      const msg = await api.sendMessage(chatId, formatReceiptHtml(receipt), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
      await setReceiptMessage(id, chatId, msg.message_id);
      await setGroupMarketState(chatId, id, { settled_notified: 1, last_phase: "resolved" });
      return "posted";
    } catch (e) {
      await releaseReceipt(id, chatId);
      throw e;
    }
  } catch (e) {
    console.error("[bot] receipt failed:", safeErr(e));
    return "failed";
  }
}

/** Re-renders already-posted receipts for a market (e.g. after a buyer's name became known, or a format fix). */
export async function rerenderReceipts(api: Bot["api"], marketId: string): Promise<number> {
  const view = await getMarketView(marketId);
  if (!view.market.isResolved) return 0;
  let n = 0;
  for (const g of await groupsForMarket(marketId)) {
    const chatId = Number(g.chat_id);
    const r = await receiptFor(marketId, chatId);
    if (!r?.message_id) continue;
    const text = formatReceiptHtml(await buildReceipt(view, { chatId }));
    const kb = isPublicHttps() ? new InlineKeyboard().url("Full receipt", marketUrl(marketId, { kind: "group", chatId })) : undefined;
    try {
      await api.editMessageText(chatId, Number(r.message_id), text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
      n++;
    } catch (e) {
      if (!/not modified/i.test(String((e as Error).message))) console.error("[bot] receipt re-render failed:", safeErr(e));
    }
  }
  return n;
}

export async function settleTick(bot: Bot) {
  for (const r of (await allGroupMarkets()).filter((x) => !x.settled_notified)) {
    const v = await getMarketView(r.market_id).catch(() => null);
    if (!v) continue;
    if (v.market.isResolved) {
      // Post the receipt whenever we first see it resolved (even if we never saw it open).
      await postReceipt(bot.api, Number(r.chat_id), v, { force: !!r.created_by_group });
      continue;
    }
    const phase = v.market.phase;
    if (phase === r.last_phase) continue;
    if (!(await claimPhase(r.chat_id, r.market_id, r.last_phase, phase))) continue; // another instance handled it
    if (!r.last_phase) continue; // first observation: just remember it
    try {
      if (phase === "secondary") {
        await bot.api.sendMessage(r.chat_id, `🔒 Buying closed on <b>${esc(v.market.title)}</b>. Final pot ${usd(v.market.totalVolumeUsdc)}. ${r.created_by_group ? `Creator royalty ≈ ${usd(v.royalty.estimatedUsdc)} (/admin).` : ""}`, { parse_mode: "HTML" });
      }
    } catch (e) {
      console.error("[bot] settle notify failed:", safeErr(e));
    }
  }
}

/** Posts a market card into a group (used right after the group's admin creates a market on the web). */
export async function postMarketCard(bot: Bot, chatId: number, marketId: string, intro?: string) {
  const view = await getMarketView(marketId);
  const m = cardMessage(cardFor(view, { kind: "group", chatId }));
  const msg = await bot.api.sendMessage(chatId, intro ? `${intro}\n\n${m.text}` : m.text, { parse_mode: "HTML", reply_markup: m.reply_markup, link_preview_options: { is_disabled: true } });
  await linkGroupMarket(chatId, marketId, { cardMessageId: msg.message_id });
  return msg.message_id;
}
