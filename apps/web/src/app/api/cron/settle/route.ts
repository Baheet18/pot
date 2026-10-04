import { runBotTicks } from "@/lib/telegram";

export const maxDuration = 60;
/** Daily safety net (Vercel Hobby cron): posts any pending buy alerts and phase/result messages. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  await runBotTicks();
  return Response.json({ ok: true });
}
