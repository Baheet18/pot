import { draftWithAI } from "@pot/server";

export const maxDuration = 60;
/** Operator-only check of the AI drafter on the deployed app (Bearer CRON_SECRET). Drafts only; nothing is saved or created. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || text.length > 500) return Response.json({ error: "send {text}" }, { status: 400 });
  return Response.json(await draftWithAI(text));
}
