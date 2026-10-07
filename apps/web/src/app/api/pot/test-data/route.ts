import { formatReceiptHtml } from "@pot/core";
import { rerenderReceipts } from "@pot/bot";
import { getBot } from "@/lib/telegram";
import { buildReceipt, buysForMarket, listPracticeMarkets, walletLinked, draftWithAI, getMarketView, getPracticeMarket, settlePracticeMarket, SANDBOX, saveDraft, sign, testDataSummary, upsertGroup, wipeTestData } from "@pot/server";

export const maxDuration = 60;
const DEMO_CHAT = -1000000000001; // not a real Telegram chat; removed by the wipe

/**
 * Operator-only (Bearer CRON_SECRET), test mode only. Never touches live-mode rows.
 *   {}                                   → counts of test rows
 *   {"confirm":"wipe-test-data"}         → deletes them
 *   {"demo":"<market idea>"}             → AI-drafts the idea into a demo group's draft and returns a create token (for screenshots/QA)
 *                                          (add "rules":true to use the basic drafter and save AI quota)
 *   {"inspect":"<id or 8+ char prefix>"} → a practice market's buys: short wallet, channel, group, whether the buyer is known
 *   {"rerender":"<id or prefix>"}      → re-renders that market's posted Telegram receipts in place (edits, never new posts)
 *   {"settle":{"id":"…","outcome":"yes"}} → settles a DEMO-group practice market and returns its receipt text (posts nothing)
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  if (!SANDBOX) return Response.json({ error: "test mode only" }, { status: 400 });
  const { confirm, demo, rules, settle, inspect, rerender } = (await req.json().catch(() => ({}))) as { confirm?: string; demo?: string; rules?: boolean; settle?: { id?: string; outcome?: string }; inspect?: string; rerender?: string };
  const findId = async (x: string) => (x.length >= 8 ? (await listPracticeMarkets(500)).find((r) => r.id === x || r.id.startsWith(x))?.id ?? null : null);
  if (typeof inspect === "string") {
    const id = await findId(inspect);
    if (!id) return Response.json({ error: "not found" }, { status: 404 });
    const buys = await buysForMarket(id);
    const v = await getMarketView(id);
    return Response.json({ id, title: v.market.title, resolved: v.market.isResolved, buys: await Promise.all(buys.map(async (b) => ({
      wallet: `${b.wallet.slice(0, 4)}…${b.wallet.slice(-4)}`, side: b.side, amount: b.amount_usdc, channel: b.channel, ref: b.ref.slice(0, 1), inGroup: b.chat_id !== null,
      buyerTgKnown: b.tg_user_id != null, walletLinked: await walletLinked(b.wallet), viaMemberLink: b.sharer_tg_id != null,
    }))) });
  }
  if (typeof rerender === "string") {
    const id = await findId(rerender);
    const bot = await getBot();
    if (!id || !bot) return Response.json({ error: "not found" }, { status: 404 });
    const edited = await rerenderReceipts(bot.api, id);
    const v = await getMarketView(id);
    return Response.json({ id, edited, html: v.market.isResolved ? formatReceiptHtml(await buildReceipt(v)) : null });
  }
  if (confirm === "wipe-test-data") return Response.json({ wiped: await wipeTestData(), left: await testDataSummary() });
  if (typeof demo === "string" && demo.length > 5 && demo.length < 500) {
    const r = await draftWithAI(demo, rules ? { key: null } : {});
    if (r.kind !== "draft") return Response.json(r);
    await upsertGroup(DEMO_CHAT, "Pot demo group");
    const row = await saveDraft(DEMO_CHAT, 0, r.draft);
    return Response.json({ draftId: row.id, token: sign({ d: row.id }, 3600), draft: r.draft });
  }
  if (settle?.id && (settle.outcome === "yes" || settle.outcome === "no")) {
    const pm = await getPracticeMarket(settle.id);
    if (!pm || pm.chat_id !== DEMO_CHAT) return Response.json({ error: "only demo-group practice markets" }, { status: 400 });
    const res = await settlePracticeMarket(settle.id, settle.outcome, null);
    const receipt = await buildReceipt(await getMarketView(settle.id)); // every buyer (demo buys come from the web, not a group)
    return Response.json({ already: res.already, outcome: res.outcome, receipt, html: formatReceiptHtml(receipt) });
  }
  return Response.json({ summary: await testDataSummary() });
}
