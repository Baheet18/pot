import Link from "next/link";
import { listLivePanta, listOpenViews, topGroups, totals, type LiveMarket } from "@pot/server";
import { fmtUsd, fmtWat } from "@pot/core";
import { MarketCard } from "@/components/MarketCard";
import { EmptyBuys } from "@/components/EmptyBuys";
import { SANDBOX } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [views, t, board, live] = await Promise.all([listOpenViews(12).catch(() => []), totals(), topGroups(5).catch(() => []), listLivePanta(6).catch((): LiveMarket[] => [])]);
  return (
    <div className="space-y-10">
      <section className="py-6">
        <h1 className="text-3xl font-black leading-tight sm:text-4xl md:text-5xl">Your group chat already argues about everything.<br /><span className="text-amber-400">Now it can put a pot on it.</span></h1>
        <p className="mt-4 max-w-2xl text-lg text-stone-300">Add <b>@pantapotbot</b> to your Telegram group. An admin types <code className="rounded bg-white/10 px-1">/new Will Tems win the Grammy?</code> and the bot drafts a fair market. Everyone buys YES or NO with one tap, and the group earns the creator royalty. When it resolves, Pot posts a receipt: who won or lost how much.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="https://t.me/pantapotbot?startgroup=true" className="rounded-lg bg-amber-400 px-5 py-3 font-bold text-black">Add Pot to a group</a>
          <Link href="/leaderboard" className="rounded-lg border border-white/20 px-5 py-3 font-semibold">See the leaderboard</Link>
        </div>
      </section>

      {(Number(t.buys) > 0 || Number(t.created) > 0) && <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Groups", t.groups], ["Markets made by groups", t.created], ["Buys through Pot", t.buys], ["Wallets", t.wallets], [SANDBOX ? "Money in (practice)" : "Brand-new to Panta", SANDBOX ? fmtUsd(Number(t.volume)) : t.newToPanta]].map(([k, v]) => (
          <div key={k} className="card p-4"><div className="text-2xl font-black">{typeof v === "string" ? v : Number(v)}</div><div className="text-xs text-stone-400">{k}</div></div>
        ))}
      </section>}

      <section>
        <h2 className="mb-3 text-xl font-bold">Open markets{SANDBOX ? <span className="ml-2 align-middle text-xs font-semibold text-sky-300">🧪 practice markets</span> : null}</h2>
        {views.length === 0 ? (
          <div className="card p-6">
            <p className="font-semibold text-stone-200">No open markets yet.</p>
            <p className="mt-1 text-sm text-stone-400">Add Pot to your Telegram group and an admin types <code className="rounded bg-white/10 px-1">/new</code> with a question. The bot drafts a fair market; once it&apos;s created it shows up here.</p>
            <a href="https://t.me/pantapotbot?startgroup=true" className="mt-4 inline-block rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black">Add Pot to a group</a>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">{views.map((v) => <MarketCard key={v.market.id} v={v} />)}</div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-bold">Live on Panta <span className="ml-2 align-middle text-xs font-semibold text-rose-300">🔴 real markets, real prices</span></h2>
        <p className="mb-3 text-sm text-stone-400">Straight from Panta&apos;s live API (read-only). Trade them on Panta; in Telegram, <code className="rounded bg-white/10 px-1">/panta</code> shows these and lets an admin post one to the group.</p>
        {live.length === 0 ? (
          <div className="card p-5 text-sm text-stone-300">No live Panta markets are open right now. Browse <a className="underline" href="https://www.panta.market">panta.market</a>, or make a practice market in your group with <code className="rounded bg-white/10 px-1">/new</code>.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">{live.map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noopener" className="card block p-4 hover:border-white/30">
              <div className="text-xs font-semibold uppercase text-rose-300">🔴 Live on Panta{m.category ? ` · ${m.category}` : ""}</div>
              <div className="mt-1 font-bold">{m.title}</div>
              <div className="mt-2 text-sm text-stone-300">YES {m.yesPrice === null ? "–" : `${Math.round(m.yesPrice * 100)}¢`} · NO {m.noPrice === null ? "–" : `${Math.round(m.noPrice * 100)}¢`} · Pot {fmtUsd(m.potUsdc)}</div>
              <div className="mt-1 text-xs text-stone-400">{m.phase === "primary" ? `Buying closes ${fmtWat(m.buyingClosesAt)}` : `Order-book trading until ${fmtWat(m.endsAt)}`} · Trade on Panta ↗</div>
            </a>
          ))}</div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-bold">How it works</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-300">
            <li>An admin types <code className="rounded bg-white/10 px-1">/new</code> with a YES/NO question. Pot drafts a fair rule, sources, and closes buying at kick-off.</li>
            <li>Members pick YES or NO. Everyone&apos;s money goes into one pot.</li>
            <li>When it resolves, Pot posts a receipt in the group: the result, the final pot, and who won or lost how much.</li>
          </ol>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-bold">Top groups</h2>
          {board.length === 0 ? <EmptyBuys compact /> : (
            <ol className="space-y-1 text-sm">{board.map((r, i) => (
              <li key={r.chat_id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{i + 1}. {r.title ?? "A Telegram group"}</span><span className="shrink-0 text-stone-400">{r.wallets} wallet{r.wallets === 1 ? "" : "s"} · {fmtUsd(r.volume)}</span></li>
            ))}</ol>
          )}
          <Link href="/leaderboard" className="mt-3 inline-block text-xs text-amber-300 underline">Full leaderboard</Link>
        </div>
      </section>
    </div>
  );
}
