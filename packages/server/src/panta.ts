import type { RawDetail, RawListItem, RawTrade } from "@pot/core";
import { pantaKey } from "./secrets";
import { LIVE_WRITES, MODE, PANTA_BASE, SANDBOX } from "./settings";

/**
 * Server-side Panta client shared by the web app and the bot.
 * - Key read from file per mode (test = sandbox fixtures, live = mainnet catalog).
 * - Read limiter (100/min, 3 concurrent) under Panta's 120 reads/min; 60s TTL cache with stale-while-revalidate.
 * - Writes go through `pantaPost`, which refuses live-key writes unless POT_ALLOW_LIVE_WRITES=1.
 */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 pot/0.1";
const BUDGET_PER_MIN = Number(process.env.PANTA_READS_PER_MIN || 100);
const MAX_CONCURRENT = 3;
const TTL_MS = 60_000;

export class PantaError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
  }
}

function headers(extra: Record<string, string> = {}) {
  return { "X-Api-Key": pantaKey(MODE), Accept: "application/json", "User-Agent": UA, ...extra };
}

type Job = { run: () => void; priority: number };
const g = globalThis as unknown as { __potL?: { stamps: number[]; queue: Job[]; active: number; timer: NodeJS.Timeout | null }; __potC?: Map<string, { at: number; v: unknown }>; __potI?: Map<string, Promise<unknown>> };
const L = (g.__potL ??= { stamps: [], queue: [], active: 0, timer: null });
const cache = (g.__potC ??= new Map());
const inflight = (g.__potI ??= new Map());

function pump() {
  const now = Date.now();
  L.stamps = L.stamps.filter((t) => now - t < 60_000);
  while (L.queue.length && L.stamps.length < BUDGET_PER_MIN && L.active < MAX_CONCURRENT) {
    L.queue.sort((a, b) => b.priority - a.priority);
    const j = L.queue.shift()!;
    L.stamps.push(Date.now());
    j.run();
  }
  if (L.queue.length && !L.timer && L.stamps.length >= BUDGET_PER_MIN) {
    L.timer = setTimeout(() => { L.timer = null; pump(); }, Math.max(50, 60_000 - (now - L.stamps[0]) + 10));
  }
}
function schedule<T>(fn: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    L.queue.push({ priority, run: () => { L.active++; fn().then(resolve, reject).finally(() => { L.active--; pump(); }); } });
    pump();
  });
}

async function parse(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function rawGet<T>(p: string, priority = 10, attempt = 0): Promise<T> {
  return schedule(async () => {
    const res = await fetch(PANTA_BASE + p, { headers: headers(), cache: "no-store" });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after") || 5) + Math.random()) * 1000));
      return rawGet<T>(p, priority, attempt + 1);
    }
    const body = await parse(res);
    if (!res.ok) throw new PantaError(res.status, body?.code ?? `HTTP_${res.status}`, `Panta GET ${p.split("?")[0]} failed: ${body?.code ?? res.status}`, body);
    return body as T;
  }, priority);
}

export async function cachedGet<T>(p: string, opts: { ttlMs?: number; validate?: (v: T) => boolean; priority?: number } = {}): Promise<T> {
  const { ttlMs = TTL_MS, validate, priority = 10 } = opts;
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  if (hit && !inflight.has(p)) {
    void fresh<T>(p, ttlMs, validate, Math.min(priority, 5)).catch(() => undefined);
    return hit.v as T;
  }
  return fresh<T>(p, ttlMs, validate, priority);
}
function fresh<T>(p: string, ttlMs: number, validate: ((v: T) => boolean) | undefined, priority: number): Promise<T> {
  const ex = inflight.get(p);
  if (ex) return ex as Promise<T>;
  const pr = (async () => {
    for (let a = 0; ; a++) {
      const v = await rawGet<T>(p, priority);
      if (!validate || validate(v) || a >= 2) {
        const ok = !validate || validate(v);
        const prev = cache.get(p);
        if (ok) cache.set(p, { at: Date.now(), v });
        else if (prev && validate!(prev.v as T)) { cache.set(p, { at: Date.now() - ttlMs + 10_000, v: prev.v }); return prev.v as T; }
        else cache.set(p, { at: Date.now() - ttlMs + 10_000, v });
        return v;
      }
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  })().finally(() => inflight.delete(p));
  inflight.set(p, pr);
  return pr;
}

export function invalidate(prefix: string) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** POST allowlist: everything a user-signed flow needs. Nothing else can be posted. */
export const WRITE_PATHS = [
  "/primaryorderquote/", "/primaryorderbuild/", "/primaryordersubmit/", "/primaryorderverify/",
  "/trades/", "/claim/build/", "/claim/creator-fees/build/",
  "/markets/create/quote/", "/markets/create/build/", "/markets/register/", "/markets/create/image-upload/",
] as const;
export type WritePath = (typeof WRITE_PATHS)[number];

export function writesAllowed(): boolean {
  return SANDBOX || LIVE_WRITES;
}

export async function pantaPost<T = Record<string, unknown>>(p: WritePath, body: Record<string, unknown>, opts: { userId?: string } = {}): Promise<T> {
  if (!WRITE_PATHS.includes(p)) throw new PantaError(403, "NOT_ALLOWED", `Path ${p} is not allowed`);
  if (!writesAllowed()) throw new PantaError(403, "LIVE_WRITES_DISABLED", "Live-key writes are disabled (set POT_ALLOW_LIVE_WRITES=1 to enable).");
  const extra: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) extra["X-User-Id"] = opts.userId;
  const send = async (attempt: number): Promise<T> => {
    const res = await fetch(PANTA_BASE + p, { method: "POST", headers: headers(extra), body: JSON.stringify(opts.userId ? { ...body, userId: opts.userId } : body), cache: "no-store" });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after") || 3) + Math.random()) * 1000));
      return send(attempt + 1);
    }
    const b = await parse(res);
    if (!res.ok) {
      const code = b?.code ?? `HTTP_${res.status}`;
      throw new PantaError(res.status, code, friendlyPantaMessage(code, b?.message ?? b?.detail, res.status), b);
    }
    return b as T;
  };
  return send(0);
}

/**
 * Plain-words messages for Panta error codes (seen on the live API: NOT_CLAIMABLE, NOT_MARKET_CREATOR, DUPLICATE_MARKET come
 * with no message). Unknown codes keep Panta's own message.
 */
const FRIENDLY: Array<[RegExp, string]> = [
  [/INSUFFICIENT.*(USDC|FUNDS|BALANCE)|NOT_ENOUGH_USDC/i, "Not enough USDC in this wallet for that amount plus Panta's 2% fee. Top up USDC (Solana) and try again."],
  [/INSUFFICIENT.*SOL|NOT_ENOUGH_SOL|LAMPORTS/i, "Not enough SOL for Solana network fees. Add about 0.01 SOL to the wallet and try again."],
  [/QUOTE.*EXPIRED|EXPIRED|BLOCKHASH/i, "That quote expired. Get a fresh quote and sign again."],
  [/SLIPPAGE|PRICE_MOVED/i, "The price moved while you were signing. Get a fresh quote."],
  [/NOT_PRIMARY|NOT_BUYABLE|PRIMARY.*(ENDED|CLOSED)|MARKET_CLOSED/i, "Buying has closed on this market."],
  [/NOT_CLAIMABLE/i, "Nothing to claim for this wallet on this market (yet). Winnings unlock after the result and Panta's 1-hour dispute window."],
  [/NOT_MARKET_CREATOR/i, "This wallet isn't the creator of this market, so there's no royalty to claim. Use the wallet that paid the creation fee."],
  [/DUPLICATE_MARKET/i, "A creation for this question is already in progress from this wallet. Wait a few minutes for it to expire, or change the question."],
  [/RATE|THROTTL|TOO_MANY/i, "Panta is busy right now. Try again in a minute."],
  [/UNAUTHORI|FORBIDDEN|API_KEY/i, "Pot couldn't talk to Panta (API key problem). The admin needs to check the setup."],
];
export function friendlyPantaMessage(code: string, message: string | undefined, status: number): string {
  const hit = FRIENDLY.find(([re]) => re.test(code) || (message ? re.test(message) : false));
  if (hit) return hit[1];
  if (message) return message;
  return status >= 500 ? "Panta is having trouble right now. Nothing was charged. Try again in a minute." : `Panta refused the request (${code}).`;
}

// ---------------------------------------------------------------- reads
export const isFullDetail = (d: RawDetail) => SANDBOX || Boolean(d && d.onChain && d.createdAt);

export async function listAllMarkets(): Promise<RawListItem[]> {
  const out: RawListItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (cursor) qs.set("cursor", cursor);
    const d: { items: RawListItem[]; nextCursor?: string | null } = await cachedGet(`/markets/?${qs}`);
    out.push(...d.items);
    cursor = d.nextCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export const getMarketDetail = (id: string) => cachedGet<RawDetail>(`/markets/${encodeURIComponent(id)}/`, { validate: isFullDetail, priority: 20 });
export async function getMarketTrades(id: string): Promise<RawTrade[]> {
  const d = await cachedGet<{ items: RawTrade[] }>(`/markets/${encodeURIComponent(id)}/trades/?limit=200`, { priority: 20 });
  return d.items ?? [];
}
export async function getWalletTrades(wallet: string): Promise<Array<{ blockTime?: number | null; signature: string; marketId?: string }>> {
  const d = await cachedGet<{ items: Array<{ blockTime?: number | null; signature: string }> }>(`/wallets/${encodeURIComponent(wallet)}/trades/`, { ttlMs: 15_000, priority: 15 });
  return d.items ?? [];
}
export interface Position { marketId: string; category: string | null; side: "yes" | "no"; shares: string; phase: string; claimable: boolean; claimed: boolean; outcome: string | null }
export async function getPositions(wallet: string): Promise<Position[]> {
  const d = await cachedGet<{ positions: Position[] }>(`/positions/?wallet=${encodeURIComponent(wallet)}`, { ttlMs: 15_000, priority: 20 });
  return d.positions ?? [];
}
export async function getTradeStatus(sig: string) {
  return rawGet<{ signature: string; status: string }>(`/trades/${encodeURIComponent(sig)}/`, 20);
}
