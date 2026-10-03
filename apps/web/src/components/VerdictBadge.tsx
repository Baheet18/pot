import type { VerdictKind } from "@pot/core";
export const VERDICT_STYLE: Record<VerdictKind, { badge: string; blurb: string; emoji: string }> = {
  Thin: { badge: "bg-stone-600/40 text-stone-100 border-stone-400/40", emoji: "🌱", blurb: "Too few real wallets or too little real money for the price to mean much yet. Early." },
  Overconfident: { badge: "bg-rose-500/20 text-rose-200 border-rose-400/50", emoji: "⚠️", blurb: "A lopsided split that hasn't been tested by time, breadth or sellers." },
  Crowded: { badge: "bg-amber-500/20 text-amber-200 border-amber-400/50", emoji: "👥", blurb: "A broad, mature crowd leaning hard one way." },
  Ordinary: { badge: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40", emoji: "✅", blurb: "Enough participation and no warning sign fired." },
};
export function VerdictBadge({ kind, size = "sm" }: { kind: VerdictKind; size?: "sm" | "lg" }) {
  const s = VERDICT_STYLE[kind];
  return <span className={`inline-flex items-center gap-1 rounded-md border font-semibold ${s.badge} ${size === "lg" ? "px-3 py-1 text-lg" : "px-2 py-0.5 text-xs"}`}>{s.emoji} {kind}</span>;
}
