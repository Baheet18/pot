import { esc } from "./card";
import type { MarketData, PayoutEstimate, RawTrade } from "./types";

/**
 * Settlement receipts. Panta is pari-passu parimutuel (panta.market/how-it-works):
 *   winner pool = all liquidity (YES + NO money) − creator royalty (20%, cut to 10/5/0% when 90%+ of traders pick one side);
 *   each winning share pays winner pool ÷ winning shares; losing shares pay nothing.
 * Live buys also pay Panta's 2% primary trading fee on top of the stake. Numbers are approximate until Panta
 * finalizes payouts after its 1-hour dispute window.
 */
export interface ReceiptBuy { signature: string; wallet: string; side: "yes" | "no"; amountUsdc: number; chatId: number | null }
export interface ReceiptPerson { wallet: string; name: string; sides: Array<"yes" | "no">; stake: number; fee: number; payout: number; net: number; won: boolean }
export interface Receipt {
  marketId: string;
  title: string;
  outcome: "yes" | "no";
  practice: boolean;
  potUsdc: number;
  royaltyPct: number;
  royaltyUsdc: number;
  winnerPoolUsdc: number;
  perWinningShare: number | null;
  feeRate: number;
  people: ReceiptPerson[];
  others: { people: number; stake: number };
}

const shortW = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

export function computeReceipt(
  m: MarketData, p: PayoutEstimate, trades: RawTrade[], buys: ReceiptBuy[],
  opts: { names?: Map<string, string>; practice: boolean; feeRate: number; chatId?: number | null },
): Receipt {
  if (!m.isResolved || m.yesWins === null) throw new Error("Market isn't resolved yet.");
  const outcome: "yes" | "no" = m.yesWins ? "yes" : "no";
  const pot = m.totalVolumeUsdc || m.volumeUsdc;
  const winnerPool = p.winnerPoolUsdc;
  const perShare = outcome === "yes" ? p.perYesShare : p.perNoShare;
  const winSideMoney = outcome === "yes" ? m.yesMoneyUsdc : m.noMoneyUsdc;
  const sharesBySig = new Map(trades.map((t) => [t.signature, Number(t.shares ?? NaN)]));
  const mine = opts.chatId === undefined ? buys : buys.filter((b) => b.chatId === opts.chatId);
  const rest = opts.chatId === undefined ? [] : buys.filter((b) => b.chatId !== opts.chatId);

  const byWallet = new Map<string, ReceiptPerson>();
  for (const b of mine) {
    const person = byWallet.get(b.wallet) ?? { wallet: b.wallet, name: opts.names?.get(b.wallet) ?? shortW(b.wallet), sides: [], stake: 0, fee: 0, payout: 0, net: 0, won: false };
    if (!person.sides.includes(b.side)) person.sides.push(b.side);
    person.stake += b.amountUsdc;
    person.fee += b.amountUsdc * opts.feeRate;
    if (b.side === outcome) {
      const shares = sharesBySig.get(b.signature);
      // Exact: shares × payout per winning share. Fallback (share count unknown): pro-rata by money on the winning side.
      person.payout += shares !== undefined && Number.isFinite(shares) && perShare !== null ? shares * perShare : winSideMoney > 0 ? (b.amountUsdc / winSideMoney) * winnerPool : 0;
      person.won = true;
    }
    byWallet.set(b.wallet, person);
  }
  const people = [...byWallet.values()].map((x) => ({ ...x, net: x.payout - x.stake - x.fee }))
    .sort((a, b) => Number(b.won) - Number(a.won) || b.net - a.net);
  return {
    marketId: m.id, title: m.title, outcome, practice: opts.practice, potUsdc: pot,
    royaltyPct: pot > 0 ? Math.round(((pot - winnerPool) / pot) * 100) : p.royaltyBps / 100,
    royaltyUsdc: Math.max(0, pot - winnerPool), winnerPoolUsdc: winnerPool, perWinningShare: perShare, feeRate: opts.feeRate,
    people, others: { people: new Set(rest.map((b) => b.wallet)).size, stake: rest.reduce((a, b) => a + b.amountUsdc, 0) },
  };
}

const money = (x: number) => `$${Math.abs(x) >= 1000 ? Math.round(Math.abs(x)).toLocaleString("en-US") : Math.abs(x).toFixed(2)}`;
const signed = (x: number) => (Math.abs(x) < 0.005 ? "±$0.00" : `${x > 0 ? "+" : "−"}${money(x)}`);
const RULE = "━━━━━━━━━━━━━━━━";

/** Telegram (HTML) receipt: short, one line per person, approx marks where Panta finalizes the number. */
export function formatReceiptHtml(r: Receipt, opts: { maxPeople?: number } = {}): string {
  const side = r.outcome.toUpperCase();
  const lines = [
    `🧾 <b>RECEIPT</b>${r.practice ? " · 🧪 <i>practice market</i>" : ""}`,
    `<b>${esc(r.title)}</b>`,
    RULE,
    `Result: ${r.outcome === "yes" ? "✅" : "❌"} <b>${side}</b>`,
    `Final pot: <b>${money(r.potUsdc)}</b>`,
    `Creator royalty (${r.royaltyPct}%): ${money(r.royaltyUsdc)}`,
    `Winners split ${money(r.winnerPoolUsdc)}${r.perWinningShare !== null ? ` · ≈${money(r.perWinningShare)} per ${side} share` : ""}`,
    RULE,
  ];
  const max = opts.maxPeople ?? 25;
  if (!r.people.length) lines.push("Nobody in this group bought this one.");
  for (const x of r.people.slice(0, max)) {
    const sides = x.sides.length > 1 ? "YES+NO" : x.sides[0].toUpperCase();
    const out = x.won ? `≈${money(x.payout)}` : "$0";
    lines.push(`${x.won ? "🏆" : "💸"} ${esc(x.name.slice(0, 24))} · ${sides} ${money(x.stake)} → ${out} (${x.won ? "≈" : ""}${signed(x.net)})`);
  }
  if (r.people.length > max) lines.push(`…and ${r.people.length - max} more`);
  if (r.others.people) lines.push(`+ ${r.others.people} buyer${r.others.people === 1 ? "" : "s"} from outside this group (${money(r.others.stake)})`);
  lines.push(RULE);
  lines.push(r.feeRate > 0
    ? `<i>≈ approx. Net includes Panta's ${Math.round(r.feeRate * 100)}% trading fee. Panta sets final payouts after its 1-hour dispute window. Winners: DM me /mine to claim.</i>`
    : `<i>≈ approx, using Panta's payout rules. Practice money only: nothing to claim. (Live markets also charge a 2% trading fee per buy.)</i>`);
  return lines.join("\n");
}
