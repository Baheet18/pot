import type { MarketData, MarketStats, PayoutEstimate } from "./types";
import { fmtWat } from "./draft";

/** Telegram market card (HTML parse mode) + keyboard spec. Pure: links are passed in. */
export interface CardLinks {
  buyYes: string;
  buyNo: string;
  details: string;
  blink?: string;
}
export interface CardButton { text: string; url?: string; callback?: string }
export interface Card { html: string; keyboard: CardButton[][] }

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function splitBar(yesShare: number | null, width = 10): string {
  if (yesShare === null) return "░".repeat(width);
  const y = Math.max(0, Math.min(width, Math.round(yesShare * width)));
  return "🟩".repeat(y) + "🟥".repeat(width - y);
}

const usd = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`;
const cents = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}¢`);

export function timeLeft(unix: number, now: number): string {
  const s = unix - now;
  if (s <= 0) return "closed";
  const h = s / 3600;
  if (h < 1) return `${Math.max(1, Math.round(s / 60))}m left`;
  if (h < 48) return `${Math.round(h)}h left`;
  return `${Math.round(h / 24)}d left`;
}

export function buyable(m: MarketData, now: number): boolean {
  return m.phase === "primary" && !m.isResolved && !m.isCancelled && (m.primaryPhaseEndTime ?? m.startTime) > now;
}

/** A clean, simple market card: question, split, pot, what a share pays, when buying closes. */
export function renderCard(
  m: MarketData,
  st: MarketStats,
  p: PayoutEstimate,
  links: CardLinks,
  opts: { now: number; sandbox: boolean; practice?: boolean; groupName?: string; buyable?: boolean },
): Card {
  const lines: string[] = [];
  if (opts.practice) lines.push("🧪 <i>Practice market: no real money</i>");
  else if (opts.sandbox) lines.push("🧪 <i>Sandbox test market (no real money)</i>");
  lines.push(`<b>${esc(m.title)}</b>`);
  if (m.category) lines.push(`🏷 <i>${esc(m.category)}</i>`);
  const ys = st.yesSplit;
  if (m.isResolved) lines.push(`🏁 <b>Result: ${m.yesWins ? "YES" : "NO"}</b>`);
  else if (m.isCancelled) lines.push("⛔ <b>Cancelled</b>");
  lines.push(ys === null ? "No buys yet. Be the first to pick a side." : `YES ${Math.round(ys * 100)}% ${splitBar(ys)} ${Math.round((1 - ys) * 100)}% NO`);
  lines.push(`💰 Pot ${usd(m.totalVolumeUsdc || m.volumeUsdc)} · 👤 ${st.realWallets} ${st.realWallets === 1 ? "person" : "people"}`);
  const py = p.perYesShare, pn = p.perNoShare;
  if (!m.isResolved && (py !== null || pn !== null)) lines.push(`A winning share pays about <b>${usd(py)}</b> (YES) or <b>${usd(pn)}</b> (NO)`);
  const closes = m.primaryPhaseEndTime ?? m.startTime;
  const isBuyable = opts.buyable ?? buyable(m, opts.now);
  if (!m.isResolved) {
    if (isBuyable && closes > opts.now) lines.push(`⏳ Buying closes ${esc(fmtWat(closes))} (${timeLeft(closes, opts.now)})`);
    else if (isBuyable) lines.push("⏳ Buying open (sandbox)");
    else lines.push("🔒 Buying closed");
    if (m.resolutionTime && m.resolutionTime > opts.now && (opts.practice || !opts.sandbox)) lines.push(`<i>Result expected by ${esc(fmtWat(m.resolutionTime))}</i>`);
  }
  if (m.resolutionRule && (opts.practice || !opts.sandbox)) {
    const rule = m.resolutionRule.replace(/\s+/g, " ").trim();
    lines.push(`📜 ${esc(rule.length > 180 ? rule.slice(0, 177).replace(/\s+\S*$/, "") + "…" : rule)} <i>(full rule: Details)</i>`);
  }
  lines.push(`<i>Powered by Panta</i>`);

  const keyboard: CardButton[][] = [];
  if (isBuyable) keyboard.push([{ text: "🟩 Buy YES", url: links.buyYes }, { text: "🟥 Buy NO", url: links.buyNo }]);
  const row: CardButton[] = [{ text: "📊 Details", url: links.details }];
  if (links.blink && isBuyable) row.push({ text: "𝕏 Share on X", url: links.blink });
  keyboard.push(row);
  return { html: lines.join("\n"), keyboard };
}
