import { draftWithAI, SANDBOX, saveDraft, sign, testDataSummary, upsertGroup, wipeTestData } from "@pot/server";

export const maxDuration = 60;
const DEMO_CHAT = -1000000000001; // not a real Telegram chat; removed by the wipe

/**
 * Operator-only (Bearer CRON_SECRET), test mode only. Never touches live-mode rows.
 *   {}                                   → counts of test rows
 *   {"confirm":"wipe-test-data"}         → deletes them
 *   {"demo":"<market idea>"}             → AI-drafts the idea into a demo group's draft and returns a create token (for screenshots/QA)
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  if (!SANDBOX) return Response.json({ error: "test mode only" }, { status: 400 });
  const { confirm, demo } = (await req.json().catch(() => ({}))) as { confirm?: string; demo?: string };
  if (confirm === "wipe-test-data") return Response.json({ wiped: await wipeTestData(), left: await testDataSummary() });
  if (typeof demo === "string" && demo.length > 5 && demo.length < 500) {
    const r = await draftWithAI(demo);
    if (r.kind !== "draft") return Response.json(r);
    await upsertGroup(DEMO_CHAT, "Pot demo group");
    const row = await saveDraft(DEMO_CHAT, 0, r.draft);
    return Response.json({ draftId: row.id, token: sign({ d: row.id }, 3600), draft: r.draft });
  }
  return Response.json({ summary: await testDataSummary() });
}
