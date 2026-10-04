import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fmtPrice, fmtTime, fmtUsd, parseAmount } from "@pot/core";
import { blinkPreviewFor, buildReceipt, getMarketView, groupTitle, marketUrl, ogImageFor, resolveRef, shareTextFor, WEB_URL, signRef, xShareFor } from "@pot/server";
import { SplitBar } from "@/components/SplitBar";
import { BuyPanel } from "@/components/BuyPanel";
import { PoweredByPanta } from "@/components/PoweredByPanta";
import { LIVE_WRITES, RPC_URL, SANDBOX, sp } from "@/lib/ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Open Graph + X card: title, split (or result) and pot, with an image rendered by /api/og/<id>. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const v = await getMarketView(id).catch(() => null);
  if (!v) return { title: "Market not found · Pot" };
  const ys = v.stats.yesSplit;
  const description = [
    v.practice || v.sandbox ? "Practice market (no real money)." : null,
    v.market.isResolved ? `Resolved ${v.market.yesWins ? "YES" : "NO"}.` : ys === null ? "No buys yet." : `${Math.round(ys * 100)}% YES / ${100 - Math.round(ys * 100)}% NO.`,
    `Pot ${fmtUsd(v.market.totalVolumeUsdc)}.`,
    v.market.isResolved ? "See the receipt on Pot, powered by Panta." : "Pick a side on Pot, powered by Panta.",
  ].filter(Boolean).join(" ");
  const image = { url: ogImageFor(id), width: 1200, height: 630, alt: v.market.title };
  return {
    title: `${v.market.title} · Pot`,
    description,
    openGraph: { type: "website", siteName: "Pot", title: v.market.title, description, url: `${WEB_URL}/m/${id}`, images: [image] },
    twitter: { card: "summary_large_image", title: v.market.title, description, images: [image.url] },
  };
}

export default async function MarketPage({ params, searchParams }: Props) {
  const { id } = await params;
  const q = await searchParams;
  const v = await getMarketView(id).catch(() => null);
  if (!v) notFound();
  const m = v.market;
  const r = resolveRef(sp(q.ref), sp(q.rs));
  const side = sp(q.side) === "no" ? "no" : sp(q.side) === "yes" ? "yes" : undefined;
  const shareRef = r.parsed;
  const shareLink = marketUrl(m.id, shareRef);
  const xShare = xShareFor(m.id, shareRef, shareTextFor(v));
  const preview = blinkPreviewFor(m.id, shareRef);
  const n = v.stats;
  const receipt = m.isResolved ? await buildReceipt(v).catch(() => null) : null;
  const group = v.practice && v.chatId !== null ? await groupTitle(v.chatId).catch(() => null) : null;
  const closes = v.sandbox && !v.practice ? "open (sandbox)" : fmtTime(m.primaryPhaseEndTime ?? m.startTime);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div>
          {v.practice && <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-200">🧪 Practice market · no real money{group ? ` · made in ${group}` : ""}</div>}
          <div className="mb-2 text-xs uppercase tracking-wide text-stone-400">{m.category} · {m.isResolved ? "settled" : v.buyable ? "buying open" : v.practice ? "buying closed" : m.phase}{v.sandbox && !v.practice ? " · sandbox fixture" : ""}</div>
          <h1 className="text-2xl font-black leading-tight break-words md:text-3xl">{m.title}</h1>
        </div>
        {m.isResolved && (
          <div data-testid="settled" className="card space-y-1 border-amber-400/50 bg-amber-400/10 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-200">Settled</div>
            <div className="text-2xl font-black">Result: {m.yesWins ? "✅ YES" : "❌ NO"}</div>
            <div className="text-sm text-stone-300">
              Final pot <b>{fmtUsd(m.totalVolumeUsdc)}</b>
              {receipt ? <> · creator royalty {receipt.royaltyPct}% · winners split <b>{fmtUsd(receipt.winnerPoolUsdc)}</b>{receipt.perWinningShare !== null ? <> · ≈${receipt.perWinningShare.toFixed(2)} per {receipt.outcome.toUpperCase()} share</> : null}</> : null}
              {m.resolvedAt ? <> · settled {fmtTime(m.resolvedAt)}</> : null}
            </div>
          </div>
        )}
        <div className="card space-y-3 p-5">
          <SplitBar yesSplit={n.yesSplit} label={m.isResolved ? "final split of the pot" : undefined} />
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-stone-400">YES price</div><b>{fmtPrice(m.yesPrice)}</b></div>
            <div><div className="text-stone-400">{m.isResolved ? "Final pot" : "Pot"}</div><b>{fmtUsd(m.totalVolumeUsdc)}</b></div>
            <div><div className="text-stone-400">People</div><b>{n.realWallets}</b> <span className="text-stone-500">({n.realWalletsYes} YES / {n.realWalletsNo} NO)</span></div>
            <div><div className="text-stone-400">Buying closes</div><b>{m.isResolved ? "closed" : closes}</b></div>
          </div>
          {!m.isResolved && <div className="rounded-lg bg-white/5 p-3 text-sm">
            {v.payout.perYesShare === null && v.payout.perNoShare === null ? <>No money in the pool yet, so there&apos;s no payout estimate. The first buyers set it.</> : <>
            If YES is right, each YES share pays about <b>{v.payout.perYesShare !== null ? `$${v.payout.perYesShare.toFixed(2)}` : "—"}</b>; if NO is right, each NO share pays about <b>{v.payout.perNoShare !== null ? `$${v.payout.perNoShare.toFixed(2)}` : "—"}</b>. <span className="text-stone-400">Estimate from the pool today; it changes as people buy.</span></>}
          </div>}
        </div>
        {receipt && (
          <div data-testid="receipt" className="card space-y-3 p-5 text-sm">
            <h2 className="font-bold">🧾 Receipt</h2>
            {receipt.people.length === 0 ? <p className="text-stone-400">No buys through Pot on this market.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-xs text-stone-400"><tr><th className="py-1 pr-2">Who</th><th className="pr-2">Side</th><th className="pr-2 text-right">Stake</th><th className="pr-2 text-right">Payout</th><th className="text-right">Net</th></tr></thead>
                  <tbody>{receipt.people.map((x) => (
                    <tr key={x.wallet} className="border-t border-white/10">
                      <td className="py-1.5 pr-2">{x.won ? (x.net >= 0 ? "🏆" : "✅") : "💸"} {x.name}</td>
                      <td className="pr-2">{x.sides.map((s) => s.toUpperCase()).join("+")}</td>
                      <td className="pr-2 text-right">${x.stake.toFixed(2)}</td>
                      <td className="pr-2 text-right">{x.won ? `≈$${x.payout.toFixed(2)}` : "$0"}</td>
                      <td className={`text-right font-semibold ${x.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{x.net >= 0 ? "+" : "−"}${Math.abs(x.net).toFixed(2)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-stone-400">{receipt.feeRate > 0
              ? `≈ approx. Net includes Panta's ${Math.round(receipt.feeRate * 100)}% trading fee. Panta sets final payouts after its 1-hour dispute window; winners claim in Pot (/mine in the bot).`
              : "≈ approx, using Panta's payout rules (winners split the pot minus the creator royalty, pro rata by shares). Practice money only: nothing to claim."}</p>
          </div>
        )}
        <div className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">How it&apos;s decided</h2>
          <p className="whitespace-pre-line text-stone-300">{m.resolutionRule ?? "No rule text published."}</p>
          {m.sources.length > 0 && <p className="break-words text-stone-400">Sources: {m.sources.map((s) => <a key={s} href={s} className="mr-2 underline" target="_blank" rel="noopener noreferrer">{s.replace(/^https?:\/\//, "")}</a>)}</p>}
          <div className="grid gap-1 text-stone-400 sm:grid-cols-3">
            <div>Buying closes<br /><b className="text-stone-200">{closes}</b></div>
            {m.endTime ? <div>Event deadline<br /><b className="text-stone-200">{fmtTime(m.endTime)}</b></div> : null}
            <div>Result expected by<br /><b className="text-stone-200">{fmtTime(m.resolutionTime)}</b></div>
          </div>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="mb-3 font-bold">{m.isResolved ? "Market settled" : "Buy a side"}</h2>
          {m.isResolved ? <p className="text-sm text-stone-300">Buying is over. The result is <b>{m.yesWins ? "YES" : "NO"}</b>.{v.practice ? " This was a practice market, so no real money moved." : " Winners can claim from /mine in the Pot bot."}</p> : <BuyPanel marketId={m.id} initialSide={side} initialAmount={parseAmount(sp(q.amount)) ?? undefined} refStr={r.ref} rs={r.ref.startsWith("g") ? signRef(r.ref) : null} buyable={v.buyable} sandbox={SANDBOX} liveWrites={LIVE_WRITES} rpc={RPC_URL} />}
          {r.parsed.kind !== "web" && <p className="mt-3 text-xs text-stone-400">Your buy counts for {r.parsed.kind === "x" ? `@${(r.parsed as { handle: string }).handle}` : "the group that shared this"}.</p>}
        </div>
        <div className="card space-y-2 p-5 text-sm">
          <h2 className="font-bold">Share</h2>
          <a href={xShare} target="_blank" rel="noopener noreferrer" data-testid="share-x" className="block rounded-lg bg-white px-3 py-2 text-center font-bold text-black">𝕏 Post on X</a>
          <a href={preview} className="block rounded-lg bg-white/10 px-3 py-2 text-center">Preview the Blink</a>
          <p className="text-xs text-stone-400">On X, people with Phantom or Backpack see buy buttons right in the post. Everyone else sees a preview card that opens this page. Link to share anywhere:</p>
          <p className="break-all rounded bg-black/30 p-2 font-mono text-[11px] text-stone-300">{shareLink}</p>
          {!WEB_URL.startsWith("https://") && <p className="text-xs text-amber-200">Blinks need a public https address; this preview runs on localhost.</p>}
        </div>
        <PoweredByPanta />
      </aside>
    </div>
  );
}
