import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { draftMarket, esc, fmtWat, renderCard, validateDraft, type Card, type Ref, type MarketDraft } from "@pot/core";
import {
  allGroupMarkets, getDraft, getMarketView, getPositions, groupLeaderboard, groupMarkets, isMarketId, isPublicHttps, linkGroupMarket,
  marketUrl, markNotified, memberName, saveDraft, setGroupMarketState, sign, SANDBOX, unnotifiedBuys, updateDraft, upsertGroup, upsertMember,
  walletsFor, blinkFor, WEB_URL, listOpenViews, type MarketView,
} from "@pot/server";

/**
 * Pot Telegram bot. Built as a factory so tests can drive it with fake updates and a fake API.
 * Buttons use URLs only when the web app has a public https URL (Telegram rejects localhost buttons);
 * otherwise links are written into the message text.
 */
export const COMMANDS = [
  { command: "new", description: "Draft a market: /new Will Nigeria beat Benin Fri 5pm?" },
  { command: "markets", description: "Markets in this group" },
  { command: "share", description: "Your personal share links for a market" },
  { command: "top", description: "Leaderboard: who brought new traders" },
  { command: "mine", description: "Your positions and winnings to claim" },
  { command: "link", description: "Link your Solana wallet" },
  { command: "admin", description: "Creator dashboard (group admins)" },
  { command: "help", description: "How Pot works" },
];

const shortW = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const usd = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`);
const SANDBOX_NOTE = SANDBOX ? "\n\n🧪 <i>Sandbox mode: test data, no real money moves.</i>" : "";

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
  return renderCard(view.market, view.verdict, view.payout,
    { buyYes: marketUrl(id, ref, "yes"), buyNo: marketUrl(id, ref, "no"), details: marketUrl(id, ref), blink: blinkFor(id, ref) },
    { now: Math.floor(Date.now() / 1000), sandbox: view.sandbox, buyable: view.buyable });
}

export function draftPreview(d: MarketDraft, problems: string[]): string {
  const lines = [
    "📝 <b>Market draft</b>",
    `<b>Question:</b> ${esc(d.question)}`,
    `<b>Rule:</b> ${esc(d.resolutionRule)}`,
    `<b>Sources:</b> ${d.sourcesOfTruth.map(esc).join(", ")}`,
    `<b>Buying closes:</b> ${esc(fmtWat(d.startTime))}`,
    `<b>Event ends:</b> ${esc(fmtWat(d.endTime))}`,
    `<b>Type:</b> ${d.marketType}${d.eventInProgress ? " (event in progress)" : ""} · fee $${d.creationFeeUsdc} · category ${d.category} · region ${esc(d.region)}`,
    `<b>You earn:</b> up to 20% of the pot as creator royalty (less if 90%+ of traders pick one side).`,
  ];
  if (d.warnings.length) lines.push("", "⚠️ " + d.warnings.map(esc).join("\n⚠️ "));
  if (problems.length) lines.push("", "❌ <b>Can't create yet:</b> " + problems.map(esc).join("; "));
  lines.push("", "<i>Not right? Send /new again with the fix, e.g. <code>/new Nigeria beat Benin | Fri 17:00</code></i>");
  return lines.join("\n") + SANDBOX_NOTE;
}

export function createBot(token: string, opts: { botInfo?: UserFromGetMe } = {}) {
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const botUser = () => bot.botInfo?.username ?? "pantapotbot";

  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) upsertMember(ctx.from.id, ctx.from.username ? `@${ctx.from.username}` : [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "));
    if (isGroup(ctx) && ctx.chat) upsertGroup(ctx.chat.id, "title" in ctx.chat ? ctx.chat.title : undefined);
    await next();
  });

  const help = [
    "🏺 <b>Pot</b>: prediction markets for your group, powered by Panta.",
    "",
    "1) A group admin types <code>/new Will Nigeria beat Benin Fri 5pm?</code>. I draft a clear rule and sources.",
    "2) The admin taps Create and pays the Panta fee ($20 breaking / $50 standard) from their wallet. The admin earns up to 20% of the pot.",
    "3) Members tap Buy YES / Buy NO and sign in Phantom. I post the pot as it grows, then the result and claim links.",
    "",
    "Every card shows a verdict (Thin / Crowded / Overconfident / Ordinary) so nobody mistakes a thin price for a real crowd, plus 'pays about $X if right' from the pool.",
    "Commands: /new /markets /share /top /mine /link /admin",
  ].join("\n");

  bot.command(["start", "help"], async (ctx) => {
    const payload = ctx.match?.toString().trim();
    if (payload === "link" && ctx.from) return sendLink(ctx);
    if (payload?.startsWith("m_") && isMarketId(payload.slice(2))) return sendCard(ctx, payload.slice(2), memberRef(ctx));
    await ctx.reply(help + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("new", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isAdmin(ctx))) return ctx.reply("Only group admins can create markets. Ask an admin, or DM me to try it yourself.");
    let draft: MarketDraft;
    try {
      draft = draftMarket(ctx.message?.text ?? "");
    } catch (e) {
      return ctx.reply((e as Error).message);
    }
    const problems = validateDraft(draft);
    const row = saveDraft(ctx.chat.id, ctx.from.id, draft);
    const kb = new InlineKeyboard();
    if (!problems.length) kb.text(`✅ Create ($${draft.creationFeeUsdc})`, `create:${row.id}`);
    kb.text("❌ Cancel", `cancel:${row.id}`);
    const msg = await ctx.reply(draftPreview(draft, problems), { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
    updateDraft(row.id, { message_id: msg.message_id });
  });

  bot.callbackQuery(/^cancel:(d_[\w-]+)$/, async (ctx) => {
    const row = getDraft(ctx.match[1]);
    if (!row || row.admin_id !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Only the admin who drafted this can cancel it." });
    if (row.status !== "created") updateDraft(row.id, { status: "cancelled" });
    await ctx.answerCallbackQuery({ text: "Draft cancelled" });
    await ctx.editMessageText("❌ Draft cancelled.");
  });

  bot.callbackQuery(/^create:(d_[\w-]+)$/, async (ctx) => {
    const row = getDraft(ctx.match[1]);
    if (!row) return ctx.answerCallbackQuery({ text: "Draft not found." });
    if (row.admin_id !== ctx.from.id) return ctx.answerCallbackQuery({ text: "Only the admin who drafted this can create it." });
    if (row.status === "created") return ctx.answerCallbackQuery({ text: "Already created." });
    updateDraft(row.id, { status: "confirmed" });
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
    const rows = isGroup(ctx) ? groupMarkets(ctx.chat.id).slice(0, 5) : [];
    if (rows.length) {
      for (const r of rows) await sendCard(ctx, r.market_id, groupRef(ctx));
      return;
    }
    const open = (await listOpenViews(8).catch(() => [])).slice(0, 3);
    if (!open.length) return ctx.reply("No open markets yet. An admin can start one with /new.");
    await ctx.reply(`No markets in this chat yet. Here are open Panta markets (admins: <code>/post &lt;id&gt;</code> to pin one here):`, { parse_mode: "HTML" });
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
    if (isGroup(ctx) && msg && "message_id" in msg) linkGroupMarket(ctx.chat.id, id, { cardMessageId: msg.message_id });
  });

  bot.command("market", async (ctx) => {
    const id = ctx.match?.toString().trim();
    if (!id || !isMarketId(id)) return ctx.reply("Usage: /market <marketId>");
    await sendCard(ctx, id, groupRef(ctx));
  });

  bot.command("share", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    let id = ctx.match?.toString().trim();
    if (!id && isGroup(ctx)) id = groupMarkets(ctx.chat.id)[0]?.market_id;
    if (!id || !isMarketId(id)) return ctx.reply("Usage: /share <marketId> (or use it in a group with a market)");
    const ref = memberRef(ctx);
    const lines = [
      `🔗 <b>Your share links</b> (buys through these count for you on /top)`,
      `Telegram / WhatsApp: ${esc(marketUrl(id, ref))}`,
      `X (Blink): ${esc(blinkFor(id, ref))}`,
    ];
    await ctx.reply(lines.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("top", async (ctx) => {
    if (!ctx.chat) return;
    if (!isGroup(ctx)) return ctx.reply("Use /top in a group to see who brought the most new traders.");
    const b = groupLeaderboard(ctx.chat.id);
    const lines = [
      `🏆 <b>Pot leaderboard</b>`,
      `This group: ${b.totals.wallets} wallet${b.totals.wallets === 1 ? "" : "s"} · ${b.totals.newToPanta} new to Panta · ${usd(b.totals.volumeUsdc)} volume · ${b.totals.buys} buys`,
    ];
    if (b.members.length) {
      lines.push("", "<b>Who brought traders</b> (via /share links):");
      b.members.forEach((m, i) => lines.push(`${i + 1}. ${esc(memberName(m.sharer_tg_id) ?? `user ${m.sharer_tg_id}`)}: ${m.new_wallets} new wallet${m.new_wallets === 1 ? "" : "s"}, ${usd(m.volume)}`));
    } else lines.push("", "No shared-link buys yet. Use /share to get your own link.");
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
    const wallets = walletsFor(ctx.from.id);
    if (!wallets.length) return sendLink(ctx);
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
    const rows = groupMarkets(ctx.chat.id).filter((r) => r.created_by_group);
    if (!rows.length) return ctx.reply("This group hasn't created a market yet. Start one with /new.");
    const out = ["🧾 <b>Creator dashboard</b>"];
    let total = 0;
    for (const r of rows.slice(0, 10)) {
      const v = await getMarketView(r.market_id).catch(() => null);
      if (!v) { out.push(`• <code>${r.market_id.slice(0, 8)}…</code>: couldn't load`); continue; }
      total += v.royalty.estimatedUsdc;
      const claim = v.royalty.claimableNow && r.creator_wallet ? `\n   claim: ${esc(`${WEB_URL}/claim/${r.market_id}?kind=creator&w=${r.creator_wallet}`)}` : "";
      out.push(`• <b>${esc(v.market.title)}</b>\n   pot ${usd(v.royalty.poolUsdc)} · royalty ${(v.royalty.royaltyBps / 100).toFixed(0)}% ≈ <b>${usd(v.royalty.estimatedUsdc)}</b> · ${v.verdict.kind} · ${v.royalty.note}${claim}`);
    }
    out.push("", `Estimated royalties: <b>${usd(total)}</b> (estimate; Panta sets the final number).`);
    await ctx.reply(out.join("\n") + SANDBOX_NOTE, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());
  bot.catch((err) => console.error("[bot] handler error:", err.error instanceof Error ? err.error.message : String(err.error)));
  return bot;
}

/** Posts new buys and phase changes into groups. Runs on an interval in main.ts. */
export async function notifyTick(bot: Bot) {
  for (const b of unnotifiedBuys()) {
    try {
      const v = await getMarketView(b.market_id).catch(() => null);
      const title = v ? v.market.title : b.market_id.slice(0, 8) + "…";
      const pot = v ? ` · pot now ${usd(v.market.totalVolumeUsdc || v.market.volumeUsdc)}` : "";
      const who = b.sharer_tg_id ? ` via ${esc(memberName(b.sharer_tg_id) ?? "a member")}'s link` : "";
      const fresh = b.new_to_panta ? " · 🎉 first ever Panta trade for this wallet" : b.new_to_pot ? " · first Pot buy for this wallet" : "";
      await bot.api.sendMessage(b.chat_id!, `${b.side === "yes" ? "🟩" : "🟥"} ${shortW(b.wallet)} bought <b>${b.side.toUpperCase()}</b> ${usd(b.amount_usdc)} on <b>${esc(title)}</b>${who}${pot}${fresh}${SANDBOX ? " 🧪" : ""}`, { parse_mode: "HTML" });
    } catch (e) {
      console.error("[bot] notify failed:", (e as Error).message);
    }
    markNotified(b.signature);
  }
}

export async function settleTick(bot: Bot) {
  for (const r of allGroupMarkets().filter((x) => !x.settled_notified)) {
    const v = await getMarketView(r.market_id).catch(() => null);
    if (!v) continue;
    const phase = v.market.isResolved ? "resolved" : v.market.phase;
    if (phase === r.last_phase) continue;
    setGroupMarketState(r.chat_id, r.market_id, { last_phase: phase });
    if (!r.last_phase) continue; // first observation: just remember it
    try {
      if (phase === "resolved") {
        await bot.api.sendMessage(r.chat_id, `🏁 <b>${esc(v.market.title)}</b> resolved <b>${v.market.yesWins ? "YES" : "NO"}</b>. Winners: DM me /mine to claim.${r.created_by_group ? " Admin: /admin for your royalty." : ""}`, { parse_mode: "HTML" });
        setGroupMarketState(r.chat_id, r.market_id, { settled_notified: 1 });
      } else if (phase === "secondary") {
        await bot.api.sendMessage(r.chat_id, `🔒 Buying closed on <b>${esc(v.market.title)}</b>. Final pot ${usd(v.market.totalVolumeUsdc)}. ${r.created_by_group ? `Creator royalty ≈ ${usd(v.royalty.estimatedUsdc)} (/admin).` : ""}`, { parse_mode: "HTML" });
      }
    } catch (e) {
      console.error("[bot] settle notify failed:", (e as Error).message);
    }
  }
}
