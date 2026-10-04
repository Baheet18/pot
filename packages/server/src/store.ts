import { randomBytes } from "node:crypto";
import type { MarketDraft } from "@pot/core";
import { MODE } from "./settings";
import { openSql, type Sql } from "./sql";

/**
 * Pot's store: Postgres (Neon) on Vercel, SQLite locally (see sql.ts). Same portable SQL for both.
 * Every row carries `mode` so sandbox test data never mixes with live data.
 */
const g = globalThis as unknown as { __potSql?: Promise<Sql> };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chat_groups (chat_id BIGINT NOT NULL, mode TEXT NOT NULL, title TEXT, added_at BIGINT NOT NULL, PRIMARY KEY (chat_id, mode))`,
  `CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, chat_id BIGINT NOT NULL, admin_id BIGINT NOT NULL, draft_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', market_id TEXT, creator_wallet TEXT, create_signature TEXT,
    message_id BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS group_markets (
    chat_id BIGINT NOT NULL, market_id TEXT NOT NULL, mode TEXT NOT NULL, created_by_group INTEGER NOT NULL DEFAULT 0,
    draft_id TEXT, creator_wallet TEXT, posted_at BIGINT NOT NULL, card_message_id BIGINT, last_phase TEXT, settled_notified INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, market_id, mode))`,
  `CREATE TABLE IF NOT EXISTS buys (
    signature TEXT NOT NULL, mode TEXT NOT NULL, market_id TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL, amount_usdc DOUBLE PRECISION NOT NULL,
    ref TEXT NOT NULL, panta_user_id TEXT NOT NULL, chat_id BIGINT, sharer_tg_id BIGINT, sharer_x TEXT, tg_user_id BIGINT,
    new_to_panta INTEGER NOT NULL DEFAULT 0, new_to_pot INTEGER NOT NULL DEFAULT 0, panta_status TEXT, attributed INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'web', created_at BIGINT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (signature, mode))`,
  `CREATE INDEX IF NOT EXISTS buys_chat ON buys(chat_id, mode)`,
  `CREATE TABLE IF NOT EXISTS members (tg_user_id BIGINT PRIMARY KEY, name TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wallet_links (tg_user_id BIGINT NOT NULL, wallet TEXT NOT NULL, mode TEXT NOT NULL, linked_at BIGINT NOT NULL, PRIMARY KEY (tg_user_id, wallet, mode))`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
];

async function init(file?: string): Promise<Sql> {
  const s = await openSql(file);
  for (const q of SCHEMA) await s.run(q);
  return s;
}
export function db(): Promise<Sql> {
  return (g.__potSql ??= init().catch((e) => { g.__potSql = undefined; throw e; }));
}
export async function resetDbForTests(file = ":memory:") {
  const old = await g.__potSql?.catch(() => undefined);
  old?.close?.();
  g.__potSql = init(file);
  return g.__potSql;
}
const all = async <T>(q: string, p: unknown[] = []) => (await db()).all<T>(q, p);
const one = async <T>(q: string, p: unknown[] = []) => (await all<T>(q, p))[0];
const run = async (q: string, p: unknown[] = []) => (await db()).run(q, p);

const now = () => Math.floor(Date.now() / 1000);
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

// ---------------------------------------------------------------- groups
export async function upsertGroup(chatId: number, title: string | undefined) {
  await run(`INSERT INTO chat_groups (chat_id, mode, title, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (chat_id, mode) DO UPDATE SET title=excluded.title`, [chatId, MODE, title ?? null, now()]);
}
export async function groupTitle(chatId: number): Promise<string | null> {
  return (await one<{ title: string }>(`SELECT title FROM chat_groups WHERE chat_id=? AND mode=?`, [chatId, MODE]))?.title ?? null;
}

// ---------------------------------------------------------------- drafts
export interface DraftRow { id: string; mode: string; chat_id: number; admin_id: number; draft: MarketDraft; status: string; market_id: string | null; creator_wallet: string | null; message_id: number | null; created_at: number }
const toDraft = (r: Record<string, unknown> | undefined): DraftRow | null =>
  r ? ({ ...(r as unknown as DraftRow), draft: JSON.parse(r.draft_json as string) } as DraftRow) : null;

export async function saveDraft(chatId: number, adminId: number, draft: MarketDraft): Promise<DraftRow> {
  const id = newId("d");
  await run(`INSERT INTO drafts (id, mode, chat_id, admin_id, draft_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, MODE, chatId, adminId, JSON.stringify(draft), now(), now()]);
  return (await getDraft(id))!;
}
export async function getDraft(id: string): Promise<DraftRow | null> {
  return toDraft(await one<Record<string, unknown>>(`SELECT * FROM drafts WHERE id=? AND mode=?`, [id, MODE]));
}
const DRAFT_COLS = new Set(["status", "market_id", "creator_wallet", "create_signature", "message_id"]);
export async function updateDraft(id: string, patch: Partial<{ status: string; market_id: string; creator_wallet: string; create_signature: string; message_id: number; draft: MarketDraft }>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "draft") { sets.push("draft_json=?"); vals.push(JSON.stringify(v)); }
    else if (DRAFT_COLS.has(k)) { sets.push(`${k}=?`); vals.push(v); }
  }
  if (!sets.length) return;
  await run(`UPDATE drafts SET ${sets.join(", ")}, updated_at=? WHERE id=? AND mode=?`, [...vals, now(), id, MODE]);
}

// ---------------------------------------------------------------- group markets
export async function linkGroupMarket(chatId: number, marketId: string, opts: { createdByGroup?: boolean; draftId?: string; creatorWallet?: string; cardMessageId?: number } = {}) {
  await run(`INSERT INTO group_markets (chat_id, market_id, mode, created_by_group, draft_id, creator_wallet, posted_at, card_message_id)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (chat_id, market_id, mode) DO UPDATE SET
      created_by_group = CASE WHEN excluded.created_by_group > group_markets.created_by_group THEN excluded.created_by_group ELSE group_markets.created_by_group END,
      draft_id = COALESCE(excluded.draft_id, group_markets.draft_id),
      creator_wallet = COALESCE(excluded.creator_wallet, group_markets.creator_wallet),
      card_message_id = COALESCE(excluded.card_message_id, group_markets.card_message_id)`,
    [chatId, marketId, MODE, opts.createdByGroup ? 1 : 0, opts.draftId ?? null, opts.creatorWallet ?? null, now(), opts.cardMessageId ?? null]);
}
export interface GroupMarketRow { chat_id: number; market_id: string; created_by_group: number; draft_id: string | null; creator_wallet: string | null; posted_at: number; card_message_id: number | null; last_phase: string | null; settled_notified: number }
export async function groupMarkets(chatId: number): Promise<GroupMarketRow[]> {
  return all<GroupMarketRow>(`SELECT * FROM group_markets WHERE chat_id=? AND mode=? ORDER BY posted_at DESC`, [chatId, MODE]);
}
export async function allGroupMarkets(): Promise<GroupMarketRow[]> {
  return all<GroupMarketRow>(`SELECT * FROM group_markets WHERE mode=?`, [MODE]);
}
const GM_COLS = new Set(["last_phase", "settled_notified", "card_message_id"]);
export async function setGroupMarketState(chatId: number, marketId: string, patch: { last_phase?: string; settled_notified?: number; card_message_id?: number }) {
  for (const [k, v] of Object.entries(patch)) if (GM_COLS.has(k)) await run(`UPDATE group_markets SET ${k}=? WHERE chat_id=? AND market_id=? AND mode=?`, [v, chatId, marketId, MODE]);
}

/** Atomically moves a group market from one observed phase to the next (true = this caller won). */
export async function claimPhase(chatId: number, marketId: string, from: string | null, to: string): Promise<boolean> {
  return (await run(`UPDATE group_markets SET last_phase=? WHERE chat_id=? AND market_id=? AND mode=? AND COALESCE(last_phase, '') = ?`, [to, chatId, marketId, MODE, from ?? ""])).changes > 0;
}

// ---------------------------------------------------------------- buys
export interface BuyInput { signature: string; marketId: string; wallet: string; side: "yes" | "no"; amountUsdc: number; ref: string; pantaUserId: string; chatId: number | null; sharerTgId: number | null; sharerX: string | null; newToPanta: boolean; pantaStatus: string; attributed: boolean; channel: "web" | "blink" | "telegram" }
export async function recordBuy(b: BuyInput): Promise<{ inserted: boolean; newToPot: boolean }> {
  const seen = await one(`SELECT 1 AS x FROM buys WHERE wallet=? AND mode=? LIMIT 1`, [b.wallet, MODE]);
  const r = await run(`INSERT INTO buys (signature, mode, market_id, wallet, side, amount_usdc, ref, panta_user_id, chat_id, sharer_tg_id, sharer_x,
    new_to_panta, new_to_pot, panta_status, attributed, channel, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [b.signature, MODE, b.marketId, b.wallet, b.side, b.amountUsdc, b.ref, b.pantaUserId, b.chatId, b.sharerTgId, b.sharerX, b.newToPanta ? 1 : 0, seen ? 0 : 1, b.pantaStatus, b.attributed ? 1 : 0, b.channel, now()]);
  return { inserted: r.changes > 0, newToPot: !seen };
}
export interface BuyRow { signature: string; market_id: string; wallet: string; side: string; amount_usdc: number; ref: string; chat_id: number | null; sharer_tg_id: number | null; new_to_panta: number; new_to_pot: number; channel: string; created_at: number }
export async function unnotifiedBuys(): Promise<BuyRow[]> {
  return all<BuyRow>(`SELECT * FROM buys WHERE mode=? AND notified=0 AND chat_id IS NOT NULL ORDER BY created_at`, [MODE]);
}
/** Atomically claims a buy for notification (so two serverless instances never post the same alert). */
export async function claimNotify(sig: string): Promise<boolean> {
  return (await run(`UPDATE buys SET notified=1 WHERE signature=? AND mode=? AND notified=0`, [sig, MODE])).changes > 0;
}
export async function markNotified(sig: string) {
  await run(`UPDATE buys SET notified=1 WHERE signature=? AND mode=?`, [sig, MODE]);
}

// ---------------------------------------------------------------- wallet links
export async function linkWallet(tgUserId: number, wallet: string) {
  await run(`INSERT INTO wallet_links (tg_user_id, wallet, mode, linked_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`, [tgUserId, wallet, MODE, now()]);
}
export async function walletsFor(tgUserId: number): Promise<string[]> {
  return (await all<{ wallet: string }>(`SELECT wallet FROM wallet_links WHERE tg_user_id=? AND mode=? ORDER BY linked_at`, [tgUserId, MODE])).map((r) => r.wallet);
}

// ---------------------------------------------------------------- leaderboards
export interface GroupBoard { totals: { buys: number; wallets: number; newToPot: number; newToPanta: number; volumeUsdc: number }; members: Array<{ sharer_tg_id: number; wallets: number; new_wallets: number; volume: number }> }
export async function groupLeaderboard(chatId: number): Promise<GroupBoard> {
  const t = await one<GroupBoard["totals"]>(`SELECT COUNT(*) AS "buys", COUNT(DISTINCT wallet) AS "wallets", COALESCE(SUM(new_to_pot),0) AS "newToPot",
    COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) AS "newToPanta", COALESCE(SUM(amount_usdc),0) AS "volumeUsdc" FROM buys WHERE chat_id=? AND mode=?`, [chatId, MODE]);
  const members = await all<GroupBoard["members"][number]>(`SELECT sharer_tg_id, COUNT(DISTINCT wallet) AS wallets, COALESCE(SUM(new_to_pot),0) AS new_wallets, COALESCE(SUM(amount_usdc),0) AS volume FROM buys
    WHERE chat_id=? AND mode=? AND sharer_tg_id IS NOT NULL GROUP BY sharer_tg_id ORDER BY new_wallets DESC, volume DESC LIMIT 10`, [chatId, MODE]);
  return { totals: { buys: t?.buys ?? 0, wallets: t?.wallets ?? 0, newToPot: t?.newToPot ?? 0, newToPanta: t?.newToPanta ?? 0, volumeUsdc: t?.volumeUsdc ?? 0 }, members };
}
export interface GlobalRow { source: string; chat_id: number | null; sharer_x: string | null; wallets: number; new_to_panta: number; new_to_pot: number; volume: number; buys: number }
export async function globalLeaderboard(): Promise<GlobalRow[]> {
  return all<GlobalRow>(`SELECT source, chat_id, sharer_x, COUNT(DISTINCT wallet) AS wallets, COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) AS new_to_panta,
    COALESCE(SUM(new_to_pot),0) AS new_to_pot, COALESCE(SUM(amount_usdc),0) AS volume, COUNT(*) AS buys
    FROM (SELECT CASE WHEN chat_id IS NOT NULL THEN 'group' WHEN sharer_x IS NOT NULL THEN 'x' ELSE 'web' END AS source, chat_id, sharer_x, wallet, new_to_panta, new_to_pot, amount_usdc
          FROM buys WHERE mode=?) b
    GROUP BY source, chat_id, sharer_x ORDER BY new_to_panta DESC, wallets DESC, volume DESC LIMIT 50`, [MODE]);
}
export async function totals() {
  const t = await one<{ buys: number; wallets: number; newToPanta: number; volume: number }>(`SELECT COUNT(*) AS "buys", COUNT(DISTINCT wallet) AS "wallets",
    COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) AS "newToPanta", COALESCE(SUM(amount_usdc),0) AS "volume" FROM buys WHERE mode=?`, [MODE]);
  const gr = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM chat_groups WHERE mode=?`, [MODE]);
  const cr = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM drafts WHERE mode=? AND status='created'`, [MODE]);
  return { buys: t?.buys ?? 0, wallets: t?.wallets ?? 0, newToPanta: t?.newToPanta ?? 0, volume: t?.volume ?? 0, groups: gr?.n ?? 0, created: cr?.n ?? 0 };
}

// ---------------------------------------------------------------- member names (for leaderboards)
export async function upsertMember(tgUserId: number, name: string) {
  await run(`INSERT INTO members (tg_user_id, name, updated_at) VALUES (?,?,?) ON CONFLICT (tg_user_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`, [tgUserId, name.slice(0, 64), now()]);
}
export async function memberName(tgUserId: number): Promise<string | null> {
  return (await one<{ name: string }>(`SELECT name FROM members WHERE tg_user_id=?`, [tgUserId]))?.name ?? null;
}

// ---------------------------------------------------------------- throttles (serverless-safe "run at most every N seconds")
export async function claimSlot(key: string, everySec: number): Promise<boolean> {
  const t = now();
  await run(`INSERT INTO kv (k, v, updated_at) VALUES (?, '0', 0) ON CONFLICT DO NOTHING`, [key]);
  return (await run(`UPDATE kv SET v=?, updated_at=? WHERE k=? AND updated_at <= ?`, [String(t), t, key, t - everySec])).changes > 0;
}
