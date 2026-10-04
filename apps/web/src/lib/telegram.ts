import "server-only";
import type { Bot } from "grammy";
import { createBot, notifyTick, settleTick } from "@pot/bot";
import { claimSlot, telegramToken } from "@pot/server";

/** One bot instance per serverless instance (webhook mode: Vercel receives updates; no polling anywhere). */
const g = globalThis as unknown as { __potBot?: Promise<Bot | null> };
export function getBot(): Promise<Bot | null> {
  return (g.__potBot ??= (async () => {
    const token = telegramToken();
    if (!token) return null;
    const bot = createBot(token);
    await bot.init();
    return bot;
  })().catch((e) => { g.__potBot = undefined; console.error("[pot] bot init failed:", (e as Error).message); return null; }));
}

/** Post pending buy alerts now; check phases/results at most every 5 minutes. Safe to call from many instances. */
export async function runBotTicks(opts: { settle?: boolean } = {}) {
  const bot = await getBot();
  if (!bot) return;
  try { await notifyTick(bot); } catch (e) { console.error("[pot] notify:", (e as Error).message); }
  if (opts.settle !== false && (await claimSlot("settle", 300))) {
    try { await settleTick(bot); } catch (e) { console.error("[pot] settle:", (e as Error).message); }
  }
}
