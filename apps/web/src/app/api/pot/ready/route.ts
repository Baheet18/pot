import { liveReadiness } from "@pot/server";

export const dynamic = "force-dynamic";

/** Operator-only (Bearer CRON_SECRET): which go-live settings are in place. Names and booleans only, never values. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  return Response.json(liveReadiness(process.env));
}
