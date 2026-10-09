/** Records Panta sandbox (pk_test) responses into packages/server/test/fixtures/sandbox.json for offline tests. */
import { writeFileSync } from "node:fs";
process.env.PANTA_MODE = "test";
process.env.POT_DB_PATH = ":memory:";
process.env.SOLANA_RPC_URL = "http://127.0.0.1:9";
const rec: Record<string, unknown> = {};
const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await real(input, init);
  const url = String(input);
  if (url.includes("panta.market")) {
    const key = `${init?.method ?? "GET"} ${url.replace(/^.*\/api\/v1/, "").replace(/\?.*$/, "")}`;
    rec[key] = await res.clone().json().catch(() => null);
  }
  return res;
}) as typeof fetch;
(async () => {
const s = await import("@pot/server");
const core = await import("@pot/core");
const W = "BSCDDRaVGiLJERmoNWTgAGcend9FUUhXEHnLFTqZHDxW", M = "TestMarket1111111111111111111111111111111";
s.resetDbForTests(":memory:");
await s.listOpenViews();
await s.getPositions(W).catch(() => null);
const b = await s.startBuy({ marketId: M, side: "yes", amountUsdc: 5, wallet: W });
await s.finishBuy({ orderId: b.orderId, quoteId: b.quoteId, signature: "sandbox_recording1", wallet: W, marketId: M, side: "yes", amountUsdc: 5, channel: "web" });
const d = s.saveDraft(-1, 1, core.draftMarket("Will Arsenal beat Chelsea on Sunday 4pm?"));
const c = await s.startCreate(d.id, W, d.admin_id);
await s.finishCreate(d.id, c.createId, "sandbox_recording2");
await s.buildClaim("win", W, M); await s.buildClaim("creator", W, M);
const json = JSON.stringify(rec, null, 1);
const { readFileSync } = await import("node:fs");
const keys = ["/home/box/.panta/test_key", "/home/box/.panta/api_key"].map((f) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } }).filter(Boolean);
console.log("contains our real keys:", keys.some((k) => json.includes(k)));
const clean = json.replace(/pk_(live|test)_[A-Za-z0-9_-]*/g, (_m, e) => `pk_${e}_…`);
if (keys.some((k) => clean.includes(k))) throw new Error("refusing to write");
writeFileSync("packages/server/test/fixtures/sandbox.json", clean);
console.log("recorded", Object.keys(rec));
})().catch((e) => { console.error(e.message); process.exit(1); });
