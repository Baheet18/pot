/** Test environment: temp secret files, in-memory DB, unreachable RPC, and a fetch mock serving recorded sandbox fixtures. */
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "pot-test-"));
const testKey = path.join(dir, "test_key");
writeFileSync(testKey, "pk_test_" + randomBytes(20).toString("hex"));
chmodSync(testKey, 0o600);
const liveKey = path.join(dir, "api_key");
writeFileSync(liveKey, "pk_live_" + randomBytes(20).toString("hex"));
chmodSync(liveKey, 0o600);
process.env.PANTA_MODE ??= "test";
process.env.PANTA_TEST_KEY_FILE = testKey;
process.env.PANTA_KEY_FILE = liveKey;
process.env.POT_HMAC_SECRET_FILE = path.join(dir, "hmac_secret");
process.env.POT_TELEGRAM_TOKEN_FILE = path.join(dir, "no_token");
process.env.POT_DB_PATH = ":memory:";
process.env.SOLANA_RPC_URL = "http://127.0.0.1:9";
process.env.POT_PUBLIC_URL = "https://pot.example";

const fx: Record<string, any> = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "sandbox.json"), "utf8"));
export interface Call { method: string; path: string; body: any; headers: Record<string, string> }
export const calls: Call[] = [];
export const overrides: Record<string, (body: any) => { status: number; json: any }> = {};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("panta.market")) throw new Error("network disabled in tests: " + url);
  const method = init?.method ?? "GET";
  let p = url.replace(/^.*\/api\/v1/, "").replace(/\?.*$/, "");
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, path: p, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
  const key = `${method} ${p}`;
  if (overrides[key]) { const o = overrides[key](body); return new Response(JSON.stringify(o.json), { status: o.status }); }
  if (/^\/wallets\/[^/]+\/trades\/$/.test(p)) p = "/wallets/BSCDDRaVGiLJERmoNWTgAGcend9FUUhXEHnLFTqZHDxW/trades/";
  const data = fx[`${method} ${p}`];
  if (data === undefined) return new Response(JSON.stringify({ code: "NOT_FOUND", message: "no fixture " + key }), { status: 404 });
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

export const W = "BSCDDRaVGiLJERmoNWTgAGcend9FUUhXEHnLFTqZHDxW";
export const M = "TestMarket1111111111111111111111111111111";
