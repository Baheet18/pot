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
  `CREATE TABLE IF NOT EXISTS practice_trades (
    signature TEXT NOT NULL, mode TEXT NOT NULL, market_id TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL, amount_usdc DOUBLE PRECISION NOT NULL,
    shares DOUBLE PRECISION NOT NULL, created_ms BIGINT NOT NULL, PRIMARY KEY (signature, mode))`,
  `CREATE TABLE IF NOT EXISTS practice_results (
    id TEXT NOT NULL, mode TEXT NOT NULL, outcome TEXT NOT NULL, settled_by BIGINT, settled_at BIGINT NOT NULL, PRIMARY KEY (id, mode))`,
  `CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT NOT NULL, mode TEXT NOT NULL, quote_id TEXT NOT NULL, market_id TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL,
    amount_usdc DOUBLE PRECISION NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (order_id, mode))`,
  `CREATE TABLE IF NOT EXISTS creates (
    create_id TEXT NOT NULL, mode TEXT NOT NULL, draft_id TEXT NOT NULL, wallet TEXT NOT NULL, fee_usdc DOUBLE PRECISION NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY (create_id, mode))`,
  `CREATE TABLE IF NOT EXISTS name_claims (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, signature TEXT NOT NULL, wallet TEXT NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS draft_choices (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, chat_id BIGINT NOT NULL, admin_id BIGINT NOT NULL, payload_json TEXT NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS receipts (
    market_id TEXT NOT NULL, chat_id BIGINT NOT NULL, mode TEXT NOT NULL, message_id BIGINT, created_at BIGINT NOT NULL, PRIMARY KEY (market_id, chat_id, mode))`,
  `CREATE TABLE IF NOT EXISTS practice_markets (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, chat_id BIGINT NOT NULL, draft_id TEXT NOT NULL, creator_wallet TEXT NOT NULL,
    draft_json TEXT NOT NULL, created_at BIGINT NOT NULL)`,
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
/** The draft whose preview message is `messageId` in this chat (for reply-to-draft edits). */
export async function draftByMessage(chatId: number, messageId: number): Promise<DraftRow | null> {
  return toDraft(await one<Record<string, unknown>>(`SELECT * FROM drafts WHERE chat_id=? AND message_id=? AND mode=?`, [chatId, messageId, MODE]));
}
/** The admin's most recent draft in this chat that hasn't been created or cancelled (for /edit). */
export async function latestOpenDraft(chatId: number, adminId: number): Promise<DraftRow | null> {
  return toDraft(await one<Record<string, unknown>>(
    `SELECT * FROM drafts WHERE chat_id=? AND admin_id=? AND mode=? AND status IN ('draft','building','confirmed') ORDER BY created_at DESC, id DESC LIMIT 1`, [chatId, adminId, MODE]));
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
export interface BuyRow { signature: string; market_id: string; wallet: string; side: string; amount_usdc: number; ref: string; chat_id: number | null; sharer_tg_id: number | null; tg_user_id?: number | null; new_to_panta: number; new_to_pot: number; channel: string; created_at: number }
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

// ---------------------------------------------------------------- practice markets (test mode only)
export interface PracticeMarketRow { id: string; chat_id: number; draft_id: string; creator_wallet: string; draft: MarketDraft; created_at: number }
const toPractice = (r: Record<string, unknown> | undefined): PracticeMarketRow | null =>
  r ? ({ ...(r as unknown as PracticeMarketRow), chat_id: Number(r.chat_id), created_at: Number(r.created_at), draft: JSON.parse(r.draft_json as string) } as PracticeMarketRow) : null;
export async function insertPracticeMarket(row: { id: string; chatId: number; draftId: string; creatorWallet: string; draft: MarketDraft }) {
  await run(`INSERT INTO practice_markets (id, mode, chat_id, draft_id, creator_wallet, draft_json, created_at) VALUES (?,?,?,?,?,?,?)`,
    [row.id, MODE, row.chatId, row.draftId, row.creatorWallet, JSON.stringify(row.draft), now()]);
}
export async function getPracticeMarket(id: string): Promise<PracticeMarketRow | null> {
  return toPractice(await one<Record<string, unknown>>(`SELECT * FROM practice_markets WHERE id=? AND mode=?`, [id, MODE]));
}
export async function listPracticeMarkets(limit = 50): Promise<PracticeMarketRow[]> {
  return (await all<Record<string, unknown>>(`SELECT * FROM practice_markets WHERE mode=? ORDER BY created_at DESC LIMIT ?`, [MODE, limit])).map((r) => toPractice(r)!);
}
/** A group's own practice markets, newest first, with their result (if settled). */
export async function practiceMarketsForChat(chatId: number): Promise<Array<PracticeMarketRow & { outcome: "yes" | "no" | null }>> {
  return (await all<Record<string, unknown>>(`SELECT p.*, r.outcome FROM practice_markets p LEFT JOIN practice_results r ON r.id=p.id AND r.mode=p.mode
    WHERE p.chat_id=? AND p.mode=? ORDER BY p.created_at DESC`, [chatId, MODE])).map((r) => ({ ...toPractice(r)!, outcome: (r.outcome as "yes" | "no" | null) ?? null }));
}
export interface PracticeTradeRow { signature: string; market_id: string; wallet: string; side: "yes" | "no"; amount_usdc: number; shares: number; created_ms: number }
/** Practice-pool fills, with the shares fixed at the moment of the buy (so the pool never depends on row order). */
export async function insertPracticeTrade(t: { signature: string; marketId: string; wallet: string; side: "yes" | "no"; amountUsdc: number; shares: number }) {
  await run(`INSERT INTO practice_trades (signature, mode, market_id, wallet, side, amount_usdc, shares, created_ms) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [t.signature, MODE, t.marketId, t.wallet, t.side, t.amountUsdc, t.shares, Date.now()]);
}
export async function practiceTrades(marketId: string): Promise<PracticeTradeRow[]> {
  return (await all<PracticeTradeRow>(`SELECT * FROM practice_trades WHERE market_id=? AND mode=? ORDER BY created_ms, signature`, [marketId, MODE]))
    .map((r) => ({ ...r, amount_usdc: Number(r.amount_usdc), shares: Number(r.shares), created_ms: Number(r.created_ms) }));
}
export async function buysForMarket(marketId: string): Promise<BuyRow[]> {
  return all<BuyRow>(`SELECT * FROM buys WHERE market_id=? AND mode=? ORDER BY created_at, signature`, [marketId, MODE]);
}
export async function buysForWallets(wallets: string[]): Promise<BuyRow[]> {
  if (!wallets.length) return [];
  return all<BuyRow>(`SELECT * FROM buys WHERE mode=? AND wallet IN (${wallets.map(() => "?").join(",")}) ORDER BY created_at`, [MODE, ...wallets]);
}

/** Test-mode reset: removes every row for MODE='test' (never touches live rows). Returns rows deleted per table. */
/** Real Telegram user ids are large; ids below this are fixtures from scripts/tests. */
const FAKE_TG_ID_MAX = 100000;
const WIPE_TABLES = ["buys", "drafts", "group_markets", "chat_groups", "practice_markets", "practice_trades", "practice_results", "receipts", "draft_choices", "name_claims", "orders", "creates"] as const;
/** Counts of test-mode rows (what wipeTestData would remove). */
export async function testDataSummary(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of WIPE_TABLES) out[t] = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE mode=?`, ["test"]))?.n ?? 0);
  out.wallet_links_fake = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM wallet_links WHERE mode=? AND tg_user_id < ?`, ["test", FAKE_TG_ID_MAX]))?.n ?? 0);
  out.wallet_links_real_kept = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM wallet_links WHERE mode=? AND tg_user_id >= ?`, ["test", FAKE_TG_ID_MAX]))?.n ?? 0);
  out.members_fake = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM members WHERE tg_user_id < ?`, [FAKE_TG_ID_MAX]))?.n ?? 0);
  return out;
}
/**
 * Removes all test-mode buys, drafts, group links, groups and practice markets, plus fixture members/links from scripts.
 * Real people's wallet links (made with /link) are kept so nobody has to re-link. Groups re-register on their next message.
 */
export async function wipeTestData(): Promise<Record<string, number>> {
  if (MODE !== "test") throw new Error("wipeTestData only runs in test mode");
  const out: Record<string, number> = {};
  for (const t of WIPE_TABLES) out[t] = (await run(`DELETE FROM ${t} WHERE mode=?`, ["test"])).changes;
  out.wallet_links_fake = (await run(`DELETE FROM wallet_links WHERE mode=? AND tg_user_id < ?`, ["test", FAKE_TG_ID_MAX])).changes;
  out.members_fake = (await run(`DELETE FROM members WHERE tg_user_id < ?`, [FAKE_TG_ID_MAX])).changes;
  return out;
}

// ---------------------------------------------------------------- public leaderboards (groups by name, people by Telegram name or short wallet)
export interface GroupRank { chat_id: number; title: string | null; wallets: number; new_to_pot: number; buys: number; volume: number }
export async function topGroups(limit = 20): Promise<GroupRank[]> {
  const rows = await all<GroupRank>(`SELECT b.chat_id AS chat_id, MAX(g.title) AS title, COUNT(DISTINCT b.wallet) AS wallets, COALESCE(SUM(b.new_to_pot),0) AS new_to_pot,
      COUNT(*) AS buys, COALESCE(SUM(b.amount_usdc),0) AS volume
    FROM buys b LEFT JOIN chat_groups g ON g.chat_id=b.chat_id AND g.mode=b.mode
    WHERE b.mode=? AND b.chat_id IS NOT NULL GROUP BY b.chat_id ORDER BY wallets DESC, volume DESC LIMIT ?`, [MODE, limit]);
  return rows.map((r) => ({ ...r, chat_id: Number(r.chat_id), wallets: Number(r.wallets), new_to_pot: Number(r.new_to_pot), buys: Number(r.buys), volume: Number(r.volume) }));
}
export interface PersonRank { key: string; name: string; telegram: boolean; wallets: number; buys: number; volume: number; brought: number }
const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
export async function topPeople(limit = 20, chatId?: number): Promise<PersonRank[]> {
  const where = chatId === undefined ? "" : " AND chat_id=?";
  const args = chatId === undefined ? [MODE] : [MODE, chatId];
  const byWallet = await all<{ wallet: string; buys: number; volume: number }>(`SELECT wallet, COUNT(*) AS buys, COALESCE(SUM(amount_usdc),0) AS volume FROM buys WHERE mode=?${where} GROUP BY wallet`, args);
  const links = await all<{ wallet: string; tg_user_id: number; name: string | null }>(`SELECT l.wallet, l.tg_user_id, m.name FROM wallet_links l LEFT JOIN members m ON m.tg_user_id=l.tg_user_id WHERE l.mode=?`, [MODE]);
  const sharers = await all<{ sharer_tg_id: number; name: string | null; brought: number }>(`SELECT b.sharer_tg_id, MAX(m.name) AS name, COUNT(DISTINCT b.wallet) AS brought FROM buys b LEFT JOIN members m ON m.tg_user_id=b.sharer_tg_id
    WHERE b.mode=? AND b.sharer_tg_id IS NOT NULL${where.replace("chat_id", "b.chat_id")} GROUP BY b.sharer_tg_id`, args);
  const owner = new Map(links.map((l) => [l.wallet, l]));
  const people = new Map<string, PersonRank>();
  const get = (key: string, name: string, telegram: boolean) => people.get(key) ?? people.set(key, { key, name, telegram, wallets: 0, buys: 0, volume: 0, brought: 0 }).get(key)!;
  for (const w of byWallet) {
    const l = owner.get(w.wallet);
    const p = l ? get(`tg:${l.tg_user_id}`, l.name ?? `Telegram user`, true) : get(`w:${w.wallet}`, shortWallet(w.wallet), false);
    p.wallets++; p.buys += Number(w.buys); p.volume += Number(w.volume);
  }
  for (const s of sharers) get(`tg:${s.sharer_tg_id}`, s.name ?? "Telegram user", true).brought += Number(s.brought);
  const xs = await all<{ sharer_x: string; brought: number }>(`SELECT sharer_x, COUNT(DISTINCT wallet) AS brought FROM buys WHERE mode=? AND sharer_x IS NOT NULL${where} GROUP BY sharer_x`, args);
  for (const x of xs) get(`x:${x.sharer_x}`, `@${x.sharer_x} on X`, false).brought += Number(x.brought);
  return [...people.values()].sort((a, b) => b.brought - a.brought || b.volume - a.volume || b.buys - a.buys).slice(0, limit);
}

/** Telegram name of whoever linked this wallet (if anyone), for buy alerts. */
export async function walletOwnerName(wallet: string): Promise<string | null> {
  const r = await one<{ name: string | null }>(`SELECT m.name FROM wallet_links l JOIN members m ON m.tg_user_id=l.tg_user_id WHERE l.mode=? AND l.wallet=? LIMIT 1`, [MODE, wallet]);
  return r?.name ?? null;
}

// ---------------------------------------------------------------- settlement: practice results and one-receipt-per-market-per-group
export interface PracticeResultRow { id: string; outcome: "yes" | "no"; settled_by: number | null; settled_at: number }
/** Records a practice market's result once. Returns false if it was already settled. */
export async function insertPracticeResult(id: string, outcome: "yes" | "no", settledBy: number | null): Promise<boolean> {
  return (await run(`INSERT INTO practice_results (id, mode, outcome, settled_by, settled_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`, [id, MODE, outcome, settledBy, now()])).changes > 0;
}
export async function getPracticeResult(id: string): Promise<PracticeResultRow | null> {
  const r = await one<PracticeResultRow>(`SELECT id, outcome, settled_by, settled_at FROM practice_results WHERE id=? AND mode=?`, [id, MODE]);
  return r ? { ...r, settled_at: Number(r.settled_at), settled_by: r.settled_by === null ? null : Number(r.settled_by) } : null;
}
/** Atomically claims the right to post the receipt for (market, group). Only the first caller gets true. */
export async function claimReceipt(marketId: string, chatId: number): Promise<boolean> {
  return (await run(`INSERT INTO receipts (market_id, chat_id, mode, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING`, [marketId, chatId, MODE, now()])).changes > 0;
}
export async function setReceiptMessage(marketId: string, chatId: number, messageId: number) {
  await run(`UPDATE receipts SET message_id=? WHERE market_id=? AND chat_id=? AND mode=?`, [messageId, marketId, chatId, MODE]);
}
/** Gives the claim back when posting failed, so a later tick can retry. */
export async function releaseReceipt(marketId: string, chatId: number) {
  await run(`DELETE FROM receipts WHERE market_id=? AND chat_id=? AND mode=? AND message_id IS NULL`, [marketId, chatId, MODE]);
}
export async function receiptFor(marketId: string, chatId: number): Promise<{ message_id: number | null } | null> {
  return (await one<{ message_id: number | null }>(`SELECT message_id FROM receipts WHERE market_id=? AND chat_id=? AND mode=?`, [marketId, chatId, MODE])) ?? null;
}
export async function groupsForMarket(marketId: string): Promise<GroupMarketRow[]> {
  return all<GroupMarketRow>(`SELECT * FROM group_markets WHERE market_id=? AND mode=?`, [marketId, MODE]);
}
/** Telegram names for many wallets at once (wallet → name). */
export async function walletOwnerNames(wallets: string[]): Promise<Map<string, string>> {
  if (!wallets.length) return new Map();
  const rows = await all<{ wallet: string; name: string }>(`SELECT l.wallet, m.name FROM wallet_links l JOIN members m ON m.tg_user_id=l.tg_user_id
    WHERE l.mode=? AND l.wallet IN (${wallets.map(() => "?").join(",")})`, [MODE, ...wallets]);
  return new Map(rows.map((r) => [r.wallet, r.name]));
}

// ---------------------------------------------------------------- multi-outcome choices ("who wins X?" → pick YES/NO markets)
export interface ChoiceOption { label: string; question: string; used?: boolean }
export interface DraftChoice { id: string; chat_id: number; admin_id: number; question: string; options: ChoiceOption[]; rephrase: string | null; created_at: number }
export async function saveChoice(chatId: number, adminId: number, c: { question: string; options: ChoiceOption[]; rephrase: string | null }): Promise<DraftChoice> {
  const id = newId("c");
  const created = now();
  await run(`INSERT INTO draft_choices (id, mode, chat_id, admin_id, payload_json, created_at) VALUES (?,?,?,?,?,?)`, [id, MODE, chatId, adminId, JSON.stringify(c), created]);
  return { id, chat_id: chatId, admin_id: adminId, ...c, created_at: created };
}
export async function getChoice(id: string): Promise<DraftChoice | null> {
  const r = await one<{ id: string; chat_id: number; admin_id: number; payload_json: string; created_at: number }>(`SELECT * FROM draft_choices WHERE id=? AND mode=?`, [id, MODE]);
  if (!r) return null;
  const p = JSON.parse(r.payload_json) as { question: string; options: ChoiceOption[]; rephrase: string | null };
  return { id: r.id, chat_id: Number(r.chat_id), admin_id: Number(r.admin_id), ...p, created_at: Number(r.created_at) };
}
export async function updateChoice(c: DraftChoice) {
  await run(`UPDATE draft_choices SET payload_json=? WHERE id=? AND mode=?`, [JSON.stringify({ question: c.question, options: c.options, rephrase: c.rephrase }), c.id, MODE]);
}

// ---------------------------------------------------------------- buyer names for web/Blink buys
/** Is this wallet linked to any Telegram user? */
export async function walletLinked(wallet: string): Promise<boolean> {
  return !!(await one(`SELECT 1 AS x FROM wallet_links WHERE wallet=? AND mode=? LIMIT 1`, [wallet, MODE]));
}
/**
 * A buy made on the website/Blink doesn't tell us who the buyer is on Telegram. The buyer's browser gets a short
 * one-time id; opening t.me/<bot>?start=n_<id> proves the Telegram side, and the buy signature proved the wallet.
 */
export async function createNameClaim(signature: string, wallet: string): Promise<string> {
  const id = newId("n");
  await run(`INSERT INTO name_claims (id, mode, signature, wallet, created_at) VALUES (?,?,?,?,?)`, [id, MODE, signature, wallet, now()]);
  return id;
}
/** Uses a name claim: tags the buy with the Telegram user and links the wallet (if it isn't linked yet). One use, 7 days. */
export async function consumeNameClaim(id: string, tgUserId: number): Promise<{ wallet: string; marketId: string | null } | null> {
  const c = await one<{ signature: string; wallet: string; created_at: number }>(`SELECT signature, wallet, created_at FROM name_claims WHERE id=? AND mode=?`, [id, MODE]);
  if (!c || now() - Number(c.created_at) > 7 * 86400) return null;
  if ((await run(`DELETE FROM name_claims WHERE id=? AND mode=?`, [id, MODE])).changes === 0) return null;
  await run(`UPDATE buys SET tg_user_id=? WHERE signature=? AND mode=? AND tg_user_id IS NULL`, [tgUserId, c.signature, MODE]);
  if (!(await walletLinked(c.wallet))) await linkWallet(tgUserId, c.wallet);
  const b = await one<{ market_id: string }>(`SELECT market_id FROM buys WHERE signature=? AND mode=?`, [c.signature, MODE]);
  return { wallet: c.wallet, marketId: b?.market_id ?? null };
}
/** Telegram names for buys that carry the buyer's Telegram id (signature → name). */
export async function buyerNames(signatures: string[]): Promise<Map<string, string>> {
  if (!signatures.length) return new Map();
  const rows = await all<{ signature: string; name: string }>(`SELECT b.signature, m.name FROM buys b JOIN members m ON m.tg_user_id=b.tg_user_id
    WHERE b.mode=? AND b.signature IN (${signatures.map(() => "?").join(",")})`, [MODE, ...signatures]);
  return new Map(rows.map((r) => [r.signature, r.name]));
}

// ---------------------------------------------------------------- live orders (what the server quoted, so finish can't be told a different side/amount)
export interface OrderRow { order_id: string; quote_id: string; market_id: string; wallet: string; side: "yes" | "no"; amount_usdc: number; created_at: number }
export async function saveOrder(o: { orderId: string; quoteId: string; marketId: string; wallet: string; side: "yes" | "no"; amountUsdc: number }) {
  await run(`INSERT INTO orders (order_id, mode, quote_id, market_id, wallet, side, amount_usdc, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    [o.orderId, MODE, o.quoteId, o.marketId, o.wallet, o.side, o.amountUsdc, now()]);
}
export async function getOrder(orderId: string): Promise<OrderRow | null> {
  const r = await one<OrderRow>(`SELECT * FROM orders WHERE order_id=? AND mode=?`, [orderId, MODE]);
  return r ? { ...r, amount_usdc: Number(r.amount_usdc), created_at: Number(r.created_at) } : null;
}
export async function saveCreate(c: { createId: string; draftId: string; wallet: string; feeUsdc: number }) {
  await run(`INSERT INTO creates (create_id, mode, draft_id, wallet, fee_usdc, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`, [c.createId, MODE, c.draftId, c.wallet, c.feeUsdc, now()]);
}
export async function getCreate(createId: string): Promise<{ draft_id: string; wallet: string; fee_usdc: number } | null> {
  return (await one<{ draft_id: string; wallet: string; fee_usdc: number }>(`SELECT draft_id, wallet, fee_usdc FROM creates WHERE create_id=? AND mode=?`, [createId, MODE])) ?? null;
}
