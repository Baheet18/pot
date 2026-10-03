import type { MarketData, PayoutEstimate, Verdict } from "./types";
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

export const VERDICT_EMOJI: Record<string, string> = { Thin: "🌱", Crowded: "👥", Overconfident: "⚠️", Ordinary: "✅" };

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

export function renderCard(
  m: MarketData,
  v: Verdict,
  p: PayoutEstimate,
  links: CardLinks,
  opts: { now: number; sandbox: boolean; groupName?: string; buyable?: boolean },
): Card {
  const n = v.numbers;
  const lines: string[] = [];
  if (opts.sandbox) lines.push("🧪 <i>Sandbox test market (no real money)</i>");
  lines.push(`<b>${esc(m.title)}</b>`);
  lines.push(`${VERDICT_EMOJI[v.kind] ?? "•"} <b>${v.kind}</b>: ${esc(v.line)}`);
  const ys = n.yesSplit;
  lines.push(`YES ${ys === null ? "—" : Math.round(ys * 100) + "%"} ${splitBar(ys)} ${ys === null ? "—" : Math.round((1 - ys) * 100) + "%"} NO <i>(money split)</i>`);
  lines.push(`Price: YES ${cents(m.yesPrice)} · NO ${cents(m.noPrice)}`);
  const py = p.perYesShare, pn = p.perNoShare;
  if (py !== null || pn !== null) {
    lines.push(`💰 Pays about <b>${usd(py)}</b>/share if YES is right · <b>${usd(pn)}</b> if NO <i>(estimate from the pool)</i>`);
  }
  const closes = m.primaryPhaseEndTime ?? m.startTime;
  const isBuyable = opts.buyable ?? buyable(m, opts.now);
  lines.push(
    `🏦 Pot ${usd(m.totalVolumeUsdc || m.volumeUsdc)} · 👤 ${n.realWallets}${n.tapeComplete ? "" : "+"} real wallet${n.realWallets === 1 ? "" : "s"} · ` +
      (m.isResolved ? `Resolved: <b>${m.yesWins ? "YES" : "NO"}</b>` : isBuyable ? (closes > opts.now ? `⏳ buying closes ${timeLeft(closes, opts.now)}` : "⏳ buying open (sandbox)") : "buy window closed"),
  );
  if (isBuyable && closes > opts.now) lines.push(`<i>Closes ${esc(fmtWat(closes))}</i>`);
  lines.push(`<i>Powered by Panta</i>`);

  const keyboard: CardButton[][] = [];
  if (isBuyable) keyboard.push([{ text: "🟩 Buy YES", url: links.buyYes }, { text: "🟥 Buy NO", url: links.buyNo }]);
  const row: CardButton[] = [{ text: "📊 Details", url: links.details }];
  if (links.blink && isBuyable) row.push({ text: "𝕏 Share as Blink", url: links.blink });
  keyboard.push(row);
  return { html: lines.join("\n"), keyboard };
}
