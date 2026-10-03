import { notFound } from "next/navigation";
import { blinkUrl, fmtPrice, fmtTime, fmtUsd } from "@pot/core";
import { getMarketView, resolveRef, WEB_URL, CLUSTER, signRef } from "@pot/server";
import { VerdictBadge, VERDICT_STYLE } from "@/components/VerdictBadge";
import { SplitBar } from "@/components/SplitBar";
import { BuyPanel } from "@/components/BuyPanel";
import { PoweredByPanta } from "@/components/PoweredByPanta";
import { LIVE_WRITES, RPC_URL, SANDBOX, sp } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const q = await searchParams;
  const v = await getMarketView(id).catch(() => null);
  if (!v) notFound();
  const m = v.market;
  const r = resolveRef(sp(q.ref), sp(q.rs));
  const side = sp(q.side) === "no" ? "no" : sp(q.side) === "yes" ? "yes" : undefined;
  const rq = new URLSearchParams({ ref: r.ref });
  if (r.ref.startsWith("g")) rq.set("rs", signRef(r.ref));
  const blink = blinkUrl(`${WEB_URL}/api/actions/m/${m.id}?${rq}`, CLUSTER);
  const n = v.verdict.numbers;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-stone-400">{m.category} · {v.buyable ? "buying open" : m.phase}{v.sandbox ? " · sandbox fixture" : ""}</div>
          <h1 className="text-3xl font-black leading-tight">{m.title}</h1>
        </div>
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-3"><VerdictBadge kind={v.verdict.kind} size="lg" /><span className="text-stone-200">{v.verdict.line}</span></div>
          <p className="text-sm text-stone-400">{VERDICT_STYLE[v.verdict.kind].blurb}</p>
          <SplitBar yesSplit={n.yesSplit} label={n.splitBasis === "real-money" ? "split of real money" : n.splitBasis === "all-money" ? "split of all money" : undefined} />
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-stone-400">YES price</div><b>{fmtPrice(m.yesPrice)}</b></div>
            <div><div className="text-stone-400">Pot</div><b>{fmtUsd(m.totalVolumeUsdc)}</b></div>
            <div><div className="text-stone-400">Real wallets</div><b>{n.realWallets}</b> <span className="text-stone-500">({n.realWalletsYes} YES / {n.realWalletsNo} NO)</span></div>
            <div><div className="text-stone-400">Buying closes</div><b>{v.sandbox ? "open (sandbox)" : fmtTime(m.primaryPhaseEndTime ?? m.startTime)}</b></div>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-sm">
            {v.payout.perYesShare === null && v.payout.perNoShare === null ? <>No money in the pool yet, so there&apos;s no payout estimate. The first buyers set it.</> : <>
            If YES is right, each YES share pays about <b>{v.payout.perYesShare !== null ? `$${v.payout.perYesShare.toFixed(2)}` : "—"}</b>; if NO is right, each NO share pays about <b>{v.payout.perNoShare !== null ? `$${v.payout.perNoShare.toFixed(2)}` : "—"}</b>. <span className="text-stone-400">Estimate from the pool today; it changes as people buy.</span></>}
          </div>
          {v.verdict.reasons.length > 0 && <details className="text-xs text-stone-400"><summary className="cursor-pointer">Why this verdict</summary><ul className="mt-2 list-disc pl-5">{v.verdict.reasons.map((x) => <li key={x}>{x}</li>)}{v.verdict.dataNotes.map((x) => <li key={x}>{x}</li>)}</ul></details>}
        </div>
        <div className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">How it&apos;s decided</h2>
          <p className="whitespace-pre-line text-stone-300">{m.resolutionRule ?? "No rule text published."}</p>
          {m.sources.length > 0 && <p className="text-stone-400">Sources: {m.sources.map((s) => <a key={s} href={s} className="mr-2 underline" target="_blank" rel="noopener noreferrer">{s.replace(/^https?:\/\//, "")}</a>)}</p>}
          <p className="text-stone-400">Resolves around {fmtTime(m.resolutionTime)}.</p>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="mb-3 font-bold">Buy a side</h2>
          <BuyPanel marketId={m.id} initialSide={side} refStr={r.ref} rs={r.ref.startsWith("g") ? signRef(r.ref) : null} buyable={v.buyable} sandbox={SANDBOX} liveWrites={LIVE_WRITES} rpc={RPC_URL} />
          {r.parsed.kind !== "web" && <p className="mt-3 text-xs text-stone-400">Your buy counts for {r.parsed.kind === "x" ? `@${(r.parsed as { handle: string }).handle}` : "the group that shared this"}.</p>}
        </div>
        <div className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">Share</h2>
          <a href={blink} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-white/10 px-3 py-2 text-center">Open as Blink (buy from X)</a>
          <p className="break-all text-xs text-stone-500">{blink}</p>
          {!WEB_URL.startsWith("https://") && <p className="text-xs text-amber-200">Blinks need a public https address; this preview runs on localhost.</p>}
        </div>
        <PoweredByPanta />
      </aside>
    </div>
  );
}
