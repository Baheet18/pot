import Link from "next/link";
import type { MarketView } from "@pot/server";
import { fmtPrice, fmtTime, fmtUsd } from "@pot/core";
import { SplitBar } from "./SplitBar";

export function MarketCard({ v }: { v: MarketView }) {
  const m = v.market;
  return (
    <Link href={`/m/${m.id}`} className="card block p-4 hover:border-amber-400/40">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{m.title}</h3>
        {m.isResolved ? <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-black">Result: {m.yesWins ? "YES" : "NO"}</span> : null}
      </div>
      {v.practice && <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-300">🧪 Practice market · {m.category}</div>}
      <SplitBar yesSplit={v.stats.yesSplit} />
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-400 max-sm:grid-cols-1">
        <div>YES {fmtPrice(m.yesPrice)} · NO {fmtPrice(m.noPrice)}</div>
        <div>Pot {fmtUsd(m.totalVolumeUsdc)}</div>
        <div>{v.stats.realWallets} {v.stats.realWallets === 1 ? "person" : "people"}</div>
      </div>
      <div className="mt-2 text-xs text-stone-500">{m.isResolved ? "Settled" : v.buyable ? (v.sandbox && !v.practice ? "Buying open (sandbox fixture)" : `Buying open · closes ${fmtTime(m.primaryPhaseEndTime ?? m.startTime)}`) : "Buying closed"}</div>
    </Link>
  );
}
