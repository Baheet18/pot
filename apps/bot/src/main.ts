import { telegramToken, MODE, WEB_URL } from "@pot/server";
import { COMMANDS, createBot, notifyTick, settleTick } from "./bot";

const token = telegramToken();
if (!token) {
  console.log("[bot] Telegram token not configured (expected ~/.pot/telegram_token, chmod 600). Bot disabled; web app still works.");
  process.exit(0);
}
const bot = createBot(token);
await bot.init();
// Long polling deletes any webhook. Never steal updates from the hosted (webhook) bot by accident.
const hook = await bot.api.getWebhookInfo();
if (hook.url && process.env.POT_FORCE_POLLING !== "1") {
  console.log(`[bot] A webhook is active (${new URL(hook.url).host}); the hosted bot is the consumer. Not starting polling (set POT_FORCE_POLLING=1 to override).`);
  process.exit(0);
}
console.log(`[bot] @${bot.botInfo.username} starting (mode=${MODE}, web=${WEB_URL})`);
await bot.api.setMyCommands(COMMANDS).catch((e) => console.error("[bot] setMyCommands failed:", e.message));
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try { await notifyTick(bot); } finally { busy = false; }
}, 10_000);
setInterval(() => void settleTick(bot).catch((e) => console.error("[bot] settle:", e.message)), 5 * 60_000);
const stop = () => { console.log("[bot] stopping"); void bot.stop(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await bot.start({ drop_pending_updates: true, allowed_updates: ["message", "callback_query", "my_chat_member"] });
