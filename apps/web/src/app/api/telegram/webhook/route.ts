import { after } from "next/server";
import { webhookCallback } from "grammy";
import { telegramWebhookSecret } from "@pot/server";
import { safeErr } from "@pot/bot";
import { getBot, runBotTicks } from "@/lib/telegram";

export const maxDuration = 60;

/** Telegram → Pot. Telegram signs each call with our secret_token header; anything else is rejected. */
export async function POST(req: Request) {
  const secret = telegramWebhookSecret();
  if (!secret) return new Response("webhook not configured", { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("unauthorized", { status: 401 });
  const bot = await getBot();
  if (!bot) return new Response("bot not configured", { status: 503 });
  const handle = webhookCallback(bot, "std/http", { secretToken: secret, timeoutMilliseconds: 50_000, onTimeout: "return" });
  let res: Response;
  try {
    res = await handle(req);
  } catch (e) {
    // Never rethrow: the error object would be logged with the bot token inside. Answer 200 so Telegram doesn't retry.
    console.error("[pot] webhook update failed:", safeErr(e));
    res = new Response(null, { status: 200 });
  }
  after(() => runBotTicks());
  return res;
}
export const GET = () => new Response("Pot Telegram webhook. POST only.", { status: 405 });
