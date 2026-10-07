/**
 * Read-only LIVE probe (no money, nothing signed or submitted). Checks that Panta's live response shapes still match Pot's code.
 * GETs: markets list, a market's detail/trades, positions. POSTs limited to QUOTE/BUILD steps that only return unsigned data:
 *   /primaryorderquote/, /primaryorderbuild/, /markets/create/quote/, /markets/create/build/, /claim/build/, /claim/creator-fees/build/.
 * Never calls submit/verify/register/trades. The key is read from ~/.panta/api_key and never printed.
 * Usage: npx tsx scripts/live-probe.mts <publicWallet>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const BASE = "https://live-api.panta.market/api/v1";
const KEY = readFileSync(`${homedir()}/.panta/api_key`, "utf8").trim();
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 pot/0.1";
const PROBE_POSTS = new Set(["/primaryorderquote/", "/primaryorderbuild/", "/markets/create/quote/", "/markets/create/build/", "/claim/build/", "/claim/creator-fees/build/"]);
const wallet = process.argv[2];
if (!wallet) throw new Error("pass a public wallet address");
const h = (x: Record<string, string> = {}) => ({ "X-Api-Key": KEY, Accept: "application/json", "User-Agent": UA, ...x });
const shape = (v: unknown, d = 0): unknown => {
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), `…${v.length}`] : [];
  if (v && typeof v === "object") return d > 2 ? "{…}" : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, d + 1)]));
  return v === null ? "null" : typeof v;
};
const scrub = (s: string) => s.split(KEY).join("[key]");
async function get(p: string) {
  const r = await fetch(BASE + p, { headers: h() });
  const j = await r.json().catch(() => null);
  console.log(`GET ${p.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "<id>")} → ${r.status}`, scrub(JSON.stringify(shape(j))).slice(0, 900));
  return j;
}
async function post(p: string, body: Record<string, unknown>) {
  if (!PROBE_POSTS.has(p)) throw new Error(`refusing ${p}`);
  const r = await fetch(BASE + p, { method: "POST", headers: h({ "Content-Type": "application/json", "X-User-Id": "pot:probe" }), body: JSON.stringify({ ...body, userId: "pot:probe" }) });
  const j = await r.json().catch(() => null);
  const errorText = !r.ok ? ` error=${scrub(JSON.stringify({ code: j?.code, message: j?.message ?? j?.detail })).slice(0, 300)}` : "";
  console.log(`POST ${p} → ${r.status}${errorText}`, r.ok ? scrub(JSON.stringify(shape(j))).slice(0, 900) : "");
  if (r.ok) for (const k of ["paymentUsdc", "liquidityInjectionUsdc", "platformRevenueUsdc", "marketType", "shares", "feeUsdc", "amountUsdc", "expectedShares", "winningShares", "claimableFeesUsdc"]) if (k in (j ?? {})) console.log(`   ${k} = ${JSON.stringify(j[k])}`);
  return { ok: r.ok, j };
}
const list = await get("/markets/?limit=50");
const items: any[] = Array.isArray(list) ? list : list?.items ?? list?.results ?? list?.markets ?? list?.data ?? [];
const open = items.find((m) => (m.phase ?? m.status) === "primary" && !m.resolved) ?? items[0];
const id = open?.marketId ?? open?.id;
console.log("markets:", items.length, "open primary found:", !!open, "phase:", open?.phase ?? open?.status);
if (id) {
  const d = await get(`/markets/${id}/`);
  await get(`/markets/${id}/trades/`);
  const q = await post("/primaryorderquote/", { wallet, marketId: id, side: "yes", amountUsdc: "1.00" });
  if (q.ok) await post("/primaryorderbuild/", { quoteId: q.j.quoteId, wallet, maxSlippageBps: 100 });
  const resolved = items.find((m) => m.resolved || m.phase === "resolved");
  if (resolved) { await get(`/markets/${resolved.marketId ?? resolved.id}/`); await post("/claim/build/", { wallet, marketId: resolved.marketId ?? resolved.id }); }
  await post("/claim/creator-fees/build/", { wallet, marketId: id });
  void d;
}
await get(`/positions/?wallet=${wallet}`);
const now = Math.floor(Date.now() / 1000);
const draft = {
  wallet, question: `Will Pot probe market X happen (probe ${now})?`, title: "Pot probe (never registered)", description: "Shape probe only; never signed or registered.",
  resolutionRule: "Resolves YES if X. Probe only.", sourcesOfTruth: ["https://www.bbc.com"], category: "other",
  startTime: now + 26 * 3600, endTime: now + 50 * 3600, resolutionTime: now + 52 * 3600, marketType: "breaking", region: "Global",
  imageUrl: "https://pot-navy.vercel.app/icon.png",
};
const cq = await post("/markets/create/quote/", draft);
if (cq.ok) await post("/markets/create/build/", { createId: cq.j.createId, wallet });
console.log("done: nothing signed, submitted or registered.");
