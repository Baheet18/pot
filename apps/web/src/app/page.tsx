import Link from "next/link";
import { globalLeaderboard, groupTitle, listOpenViews, totals } from "@pot/server";
import { fmtUsd } from "@pot/core";
import { MarketCard } from "@/components/MarketCard";
import { VERDICT_STYLE } from "@/components/VerdictBadge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [views, t, board] = await Promise.all([listOpenViews(12).catch(() => []), totals(), globalLeaderboard().then((r) => r.slice(0, 5))]);
  const titles = await Promise.all(board.map((r) => (r.chat_id !== null ? groupTitle(r.chat_id) : Promise.resolve(null))));
  return (
    <div className="space-y-10">
      <section className="py-6">
        <h1 className="text-4xl font-black leading-tight md:text-5xl">Your group chat already argues about everything.<br /><span className="text-amber-400">Now it can put a pot on it.</span></h1>
        <p className="mt-4 max-w-2xl text-lg text-stone-300">Add <b>@pantapotbot</b> to your Telegram group. An admin types <code className="rounded bg-white/10 px-1">/new Will Tems win the Grammy?</code> and the bot drafts a fair market. Everyone buys YES or NO with one tap, and the group earns the creator royalty. Every card says honestly whether the odds mean anything yet.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="https://t.me/pantapotbot?startgroup=true" className="rounded-lg bg-amber-400 px-5 py-3 font-bold text-black">Add Pot to a group</a>
          <Link href="/leaderboard" className="rounded-lg border border-white/20 px-5 py-3 font-semibold">See the leaderboard</Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Groups", t.groups], ["Markets made by groups", t.created], ["Buys through Pot", t.buys], ["Wallets", t.wallets], ["Brand-new to Panta", t.newToPanta]].map(([k, v]) => (
          <div key={k} className="card p-4"><div className="text-2xl font-black">{v}</div><div className="text-xs text-stone-400">{k}</div></div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Open markets</h2>
        {views.length === 0 ? <p className="text-stone-400">No open markets right now.</p> : (
          <div className="grid gap-4 md:grid-cols-2">{views.map((v) => <MarketCard key={v.market.id} v={v} />)}</div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-bold">What the verdict means</h2>
          <ul className="space-y-2 text-sm">
            {Object.entries(VERDICT_STYLE).map(([k, s]) => <li key={k}><b>{s.emoji} {k}:</b> <span className="text-stone-300">{s.blurb}</span></li>)}
          </ul>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-bold">Top groups</h2>
          {board.length === 0 ? <p className="text-sm text-stone-400">No buys yet.</p> : (
            <ol className="space-y-1 text-sm">{board.map((r, i) => (
              <li key={i} className="flex justify-between"><span>{i + 1}. {r.source === "group" ? titles[i] ?? "A group" : r.source === "x" ? `@${r.sharer_x}` : "Website"}</span><span className="text-stone-400">{r.new_to_panta} new · {r.wallets} wallets · {fmtUsd(r.volume)}</span></li>
            ))}</ol>
          )}
        </div>
      </section>
    </div>
  );
}
