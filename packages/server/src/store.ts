import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { MarketDraft } from "@pot/core";
import { DB_PATH, MODE } from "./settings";

/**
 * Local SQLite store shared by the bot and web processes (WAL mode handles both).
 * Every row carries `mode` so sandbox test data never mixes with live data.
 * For hosting, swap this file for Postgres/Turso (same tables).
 */
export type Db = Database.Database;
const g = globalThis as unknown as { __potDb?: Db };

export function db(file = DB_PATH): Db {
  if (g.__potDb) return g.__potDb;
  if (file !== ":memory:") mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 3000");
  migrate(d);
  g.__potDb = d;
  return d;
}
export function resetDbForTests(file = ":memory:") {
  g.__potDb?.close();
  g.__potDb = undefined;
  return db(file);
}

function migrate(d: Db) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS groups (chat_id INTEGER NOT NULL, mode TEXT NOT NULL, title TEXT, added_at INTEGER NOT NULL, PRIMARY KEY (chat_id, mode));
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, chat_id INTEGER NOT NULL, admin_id INTEGER NOT NULL, draft_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', market_id TEXT, creator_wallet TEXT, create_signature TEXT,
    message_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS group_markets (
    chat_id INTEGER NOT NULL, market_id TEXT NOT NULL, mode TEXT NOT NULL, created_by_group INTEGER NOT NULL DEFAULT 0,
    draft_id TEXT, creator_wallet TEXT, posted_at INTEGER NOT NULL, card_message_id INTEGER, last_phase TEXT, settled_notified INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, market_id, mode));
  CREATE TABLE IF NOT EXISTS buys (
    signature TEXT NOT NULL, mode TEXT NOT NULL, market_id TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL, amount_usdc REAL NOT NULL,
    ref TEXT NOT NULL, panta_user_id TEXT NOT NULL, chat_id INTEGER, sharer_tg_id INTEGER, sharer_x TEXT, tg_user_id INTEGER,
    new_to_panta INTEGER NOT NULL DEFAULT 0, new_to_pot INTEGER NOT NULL DEFAULT 0, panta_status TEXT, attributed INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL DEFAULT 'web', created_at INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (signature, mode));
  CREATE INDEX IF NOT EXISTS buys_chat ON buys(chat_id, mode);
  CREATE TABLE IF NOT EXISTS members (tg_user_id INTEGER PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS wallet_links (tg_user_id INTEGER NOT NULL, wallet TEXT NOT NULL, mode TEXT NOT NULL, linked_at INTEGER NOT NULL, PRIMARY KEY (tg_user_id, wallet, mode));
  `);
}

const now = () => Math.floor(Date.now() / 1000);
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

// ---------------------------------------------------------------- groups
export function upsertGroup(chatId: number, title: string | undefined) {
  db().prepare(`INSERT INTO groups (chat_id, mode, title, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, mode) DO UPDATE SET title=excluded.title`).run(chatId, MODE, title ?? null, now());
}
export function groupTitle(chatId: number): string | null {
  return (db().prepare(`SELECT title FROM groups WHERE chat_id=? AND mode=?`).get(chatId, MODE) as { title: string } | undefined)?.title ?? null;
}

// ---------------------------------------------------------------- drafts
export interface DraftRow { id: string; mode: string; chat_id: number; admin_id: number; draft: MarketDraft; status: string; market_id: string | null; creator_wallet: string | null; message_id: number | null; created_at: number }
const toDraft = (r: Record<string, unknown> | undefined): DraftRow | null =>
  r ? ({ ...(r as unknown as DraftRow), draft: JSON.parse(r.draft_json as string) } as DraftRow) : null;

export function saveDraft(chatId: number, adminId: number, draft: MarketDraft): DraftRow {
  const id = newId("d");
  db().prepare(`INSERT INTO drafts (id, mode, chat_id, admin_id, draft_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`).run(id, MODE, chatId, adminId, JSON.stringify(draft), now(), now());
  return getDraft(id)!;
}
export function getDraft(id: string): DraftRow | null {
  return toDraft(db().prepare(`SELECT * FROM drafts WHERE id=? AND mode=?`).get(id, MODE) as Record<string, unknown> | undefined);
}
export function updateDraft(id: string, patch: Partial<{ status: string; market_id: string; creator_wallet: string; create_signature: string; message_id: number; draft: MarketDraft }>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "draft") { sets.push("draft_json=?"); vals.push(JSON.stringify(v)); }
    else { sets.push(`${k}=?`); vals.push(v); }
  }
  if (!sets.length) return;
  db().prepare(`UPDATE drafts SET ${sets.join(", ")}, updated_at=? WHERE id=? AND mode=?`).run(...vals, now(), id, MODE);
}

// ---------------------------------------------------------------- group markets
export function linkGroupMarket(chatId: number, marketId: string, opts: { createdByGroup?: boolean; draftId?: string; creatorWallet?: string; cardMessageId?: number } = {}) {
  db().prepare(`INSERT INTO group_markets (chat_id, market_id, mode, created_by_group, draft_id, creator_wallet, posted_at, card_message_id)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(chat_id, market_id, mode) DO UPDATE SET
      created_by_group=MAX(created_by_group, excluded.created_by_group), draft_id=COALESCE(excluded.draft_id, draft_id),
      creator_wallet=COALESCE(excluded.creator_wallet, creator_wallet), card_message_id=COALESCE(excluded.card_message_id, card_message_id)`)
    .run(chatId, marketId, MODE, opts.createdByGroup ? 1 : 0, opts.draftId ?? null, opts.creatorWallet ?? null, now(), opts.cardMessageId ?? null);
}
export interface GroupMarketRow { chat_id: number; market_id: string; created_by_group: number; draft_id: string | null; creator_wallet: string | null; posted_at: number; card_message_id: number | null; last_phase: string | null; settled_notified: number }
export function groupMarkets(chatId: number): GroupMarketRow[] {
  return db().prepare(`SELECT * FROM group_markets WHERE chat_id=? AND mode=? ORDER BY posted_at DESC`).all(chatId, MODE) as GroupMarketRow[];
}
export function allGroupMarkets(): GroupMarketRow[] {
  return db().prepare(`SELECT * FROM group_markets WHERE mode=?`).all(MODE) as GroupMarketRow[];
}
export function setGroupMarketState(chatId: number, marketId: string, patch: { last_phase?: string; settled_notified?: number; card_message_id?: number }) {
  for (const [k, v] of Object.entries(patch)) db().prepare(`UPDATE group_markets SET ${k}=? WHERE chat_id=? AND market_id=? AND mode=?`).run(v, chatId, marketId, MODE);
}

// ---------------------------------------------------------------- buys
export interface BuyInput { signature: string; marketId: string; wallet: string; side: "yes" | "no"; amountUsdc: number; ref: string; pantaUserId: string; chatId: number | null; sharerTgId: number | null; sharerX: string | null; newToPanta: boolean; pantaStatus: string; attributed: boolean; channel: "web" | "blink" | "telegram" }
export function recordBuy(b: BuyInput): { inserted: boolean; newToPot: boolean } {
  const d = db();
  const seen = d.prepare(`SELECT 1 FROM buys WHERE wallet=? AND mode=? LIMIT 1`).get(b.wallet, MODE);
  const r = d.prepare(`INSERT OR IGNORE INTO buys (signature, mode, market_id, wallet, side, amount_usdc, ref, panta_user_id, chat_id, sharer_tg_id, sharer_x,
    new_to_panta, new_to_pot, panta_status, attributed, channel, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.signature, MODE, b.marketId, b.wallet, b.side, b.amountUsdc, b.ref, b.pantaUserId, b.chatId, b.sharerTgId, b.sharerX, b.newToPanta ? 1 : 0, seen ? 0 : 1, b.pantaStatus, b.attributed ? 1 : 0, b.channel, now());
  return { inserted: r.changes > 0, newToPot: !seen };
}
export interface BuyRow { signature: string; market_id: string; wallet: string; side: string; amount_usdc: number; ref: string; chat_id: number | null; sharer_tg_id: number | null; new_to_panta: number; new_to_pot: number; channel: string; created_at: number }
export function unnotifiedBuys(): BuyRow[] {
  return db().prepare(`SELECT * FROM buys WHERE mode=? AND notified=0 AND chat_id IS NOT NULL ORDER BY created_at`).all(MODE) as BuyRow[];
}
export function markNotified(sig: string) {
  db().prepare(`UPDATE buys SET notified=1 WHERE signature=? AND mode=?`).run(sig, MODE);
}

// ---------------------------------------------------------------- wallet links
export function linkWallet(tgUserId: number, wallet: string) {
  db().prepare(`INSERT OR IGNORE INTO wallet_links (tg_user_id, wallet, mode, linked_at) VALUES (?,?,?,?)`).run(tgUserId, wallet, MODE, now());
}
export function walletsFor(tgUserId: number): string[] {
  return (db().prepare(`SELECT wallet FROM wallet_links WHERE tg_user_id=? AND mode=? ORDER BY linked_at`).all(tgUserId, MODE) as { wallet: string }[]).map((r) => r.wallet);
}

// ---------------------------------------------------------------- leaderboards
export interface GroupBoard { totals: { buys: number; wallets: number; newToPot: number; newToPanta: number; volumeUsdc: number }; members: Array<{ sharer_tg_id: number; wallets: number; new_wallets: number; volume: number }> }
export function groupLeaderboard(chatId: number): GroupBoard {
  const d = db();
  const t = d.prepare(`SELECT COUNT(*) buys, COUNT(DISTINCT wallet) wallets, SUM(new_to_pot) newToPot, COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) newToPanta, COALESCE(SUM(amount_usdc),0) volumeUsdc FROM buys WHERE chat_id=? AND mode=?`).get(chatId, MODE) as GroupBoard["totals"];
  const members = d.prepare(`SELECT sharer_tg_id, COUNT(DISTINCT wallet) wallets, SUM(new_to_pot) new_wallets, SUM(amount_usdc) volume FROM buys
    WHERE chat_id=? AND mode=? AND sharer_tg_id IS NOT NULL GROUP BY sharer_tg_id ORDER BY new_wallets DESC, volume DESC LIMIT 10`).all(chatId, MODE) as GroupBoard["members"];
  return { totals: { buys: t.buys ?? 0, wallets: t.wallets ?? 0, newToPot: t.newToPot ?? 0, newToPanta: t.newToPanta ?? 0, volumeUsdc: t.volumeUsdc ?? 0 }, members };
}
export interface GlobalRow { source: string; chat_id: number | null; sharer_x: string | null; wallets: number; new_to_panta: number; new_to_pot: number; volume: number; buys: number }
export function globalLeaderboard(): GlobalRow[] {
  return db().prepare(`SELECT CASE WHEN chat_id IS NOT NULL THEN 'group' WHEN sharer_x IS NOT NULL THEN 'x' ELSE 'web' END source, chat_id, sharer_x,
    COUNT(DISTINCT wallet) wallets, COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) new_to_panta, SUM(new_to_pot) new_to_pot, SUM(amount_usdc) volume, COUNT(*) buys
    FROM buys WHERE mode=? GROUP BY source, chat_id, sharer_x ORDER BY new_to_panta DESC, wallets DESC, volume DESC LIMIT 50`).all(MODE) as GlobalRow[];
}
export function totals() {
  return db().prepare(`SELECT COUNT(*) buys, COUNT(DISTINCT wallet) wallets, COUNT(DISTINCT CASE WHEN new_to_panta=1 THEN wallet END) newToPanta, COALESCE(SUM(amount_usdc),0) volume,
    (SELECT COUNT(*) FROM groups WHERE mode=?) groups, (SELECT COUNT(*) FROM drafts WHERE mode=? AND status='created') created FROM buys WHERE mode=?`).get(MODE, MODE, MODE) as
    { buys: number; wallets: number; newToPanta: number; volume: number; groups: number; created: number };
}

// ---------------------------------------------------------------- member names (for leaderboards)
export function upsertMember(tgUserId: number, name: string) {
  db().prepare(`INSERT INTO members (tg_user_id, name, updated_at) VALUES (?,?,?) ON CONFLICT(tg_user_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`).run(tgUserId, name.slice(0, 64), now());
}
export function memberName(tgUserId: number): string | null {
  return (db().prepare(`SELECT name FROM members WHERE tg_user_id=?`).get(tgUserId) as { name: string } | undefined)?.name ?? null;
}
