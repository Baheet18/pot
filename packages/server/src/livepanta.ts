/**
 * Read-only window onto LIVE Panta markets, used in practice mode so groups see real markets and prices.
 * GET only: this module has no way to send a write, and it never touches the live-write path (`pantaPost`).
 * Key: PANTA_READ_KEY (Vercel) or ~/.panta/api_key locally. 60s cache; a small request budget.
 */
import { pantaReadKey } from "./secrets";
import { PANTA_BASE } from "./settings";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 pot/0.1";
const TTL_MS = 60_000;
export const PANTA_SITE = "https://www.panta.market";
export const pantaMarketUrl = (id: string) => `${PANTA_SITE}/market/${encodeURIComponent(id)}`;

export interface LiveMarket {
  id: string; title: string; category: string; phase: "primary" | "secondary";
  yesPrice: number | null; noPrice: number | null; potUsdc: number;
  /** Primary: buying closes at startTime. Secondary: order-book trading until endTime. */
  buyingClosesAt: number; endsAt: number; marketType: string; url: string;
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
const cache = new Map<string, { at: number; v: Promise<unknown> }>();
/** Tests only. */
export const setLiveFetcher = (f: Fetcher | null) => { fetcher = f ?? ((...a) => fetch(...a)); cache.clear(); };

export const liveReadsEnabled = () => !!pantaReadKey();

async function liveGet<T>(p: string): Promise<T> {
  if (!/^\/markets\/(\?[\w=&%.-]*|[1-9A-HJ-NP-Za-km-z]{32,44}\/)$/.test(p)) throw new Error("live reads: path not allowed");
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v as Promise<T>;
  const key = pantaReadKey();
  if (!key) throw new Error("live reads not configured");
  const v = (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetcher(PANTA_BASE + p, { method: "GET", headers: { "X-Api-Key": key, Accept: "application/json", "User-Agent": UA }, signal: ctl.signal, cache: "no-store" } as RequestInit);
      if (!res.ok) throw new Error(`live read ${res.status}`);
      return (await res.json()) as T;
    } finally { clearTimeout(t); }
  })();
  cache.set(p, { at: Date.now(), v });
  v.catch(() => cache.delete(p));
  return v;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export function toLiveMarket(x: any, now: number): LiveMarket | null {
  const title = String(x?.title ?? "").trim();
  const phase = x?.phase === "primary" || x?.status === "primary" ? "primary" : x?.phase === "secondary" || x?.status === "secondary" ? "secondary" : null;
  const endsAt = num(x?.endTime) ?? 0, start = num(x?.startTime) ?? 0;
  if (!x?.marketId || !title || !phase || x?.resolved || endsAt <= now) return null;
  if (phase === "primary" && start <= now) return null; // buying window already over, waiting for Panta to flip phase
  const yes = num(phase === "secondary" ? x.secondaryYesPrice ?? x.yesPrice : x.yesPrice);
  const no = num(phase === "secondary" ? x.secondaryNoPrice ?? x.noPrice : x.noPrice) ?? (yes !== null ? 1 - yes : null);
  return {
    id: String(x.marketId), title: title.slice(0, 200), category: String(x.category ?? ""), phase, yesPrice: yes, noPrice: no,
    potUsdc: num(x.totalVolumeUsdc) ?? num(x.volumeUsdc) ?? 0, buyingClosesAt: start, endsAt, marketType: String(x.marketType ?? ""), url: pantaMarketUrl(String(x.marketId)),
  };
}

/** Open live Panta markets: buy-phase ones first (soonest close), then order-book ones by pot. Empty list on any error. */
export async function listLivePanta(limit = 6, now = Math.floor(Date.now() / 1000)): Promise<LiveMarket[]> {
  try {
    const d = await liveGet<{ items?: unknown[] }>("/markets/?limit=100");
    const all = (d.items ?? []).map((x) => toLiveMarket(x, now)).filter((m): m is LiveMarket => !!m);
    all.sort((a, b) => (a.phase === b.phase ? (a.phase === "primary" ? a.buyingClosesAt - b.buyingClosesAt : b.potUsdc - a.potUsdc) : a.phase === "primary" ? -1 : 1));
    return all.slice(0, limit);
  } catch { return []; }
}
export async function getLivePanta(id: string, now = Math.floor(Date.now() / 1000)): Promise<LiveMarket | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return null;
  try {
    const listed = (await listLivePanta(100, now)).find((m) => m.id === id);
    if (listed) return listed;
    return toLiveMarket(await liveGet(`/markets/${id}/`), now);
  } catch { return null; }
}
