import { topGroups, topPeople, totals } from "@pot/server";
import { fmtUsd } from "@pot/core";
import { EmptyBuys } from "@/components/EmptyBuys";
import { SANDBOX } from "@/lib/ui";

export const dynamic = "force-dynamic";
const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function Leaderboard() {
  const [groups, people, t] = await Promise.all([topGroups(25), topPeople(25), totals()]);
  const buys = Number(t.buys);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black">Leaderboard</h1>
        <p className="mt-1 text-stone-300">
          {buys === 0 ? "Groups and people who get their friends buying show up here." : `${pl(buys, "buy")} from ${pl(Number(t.wallets), "wallet")} so far, ${fmtUsd(Number(t.volume))} in total.`}
          {SANDBOX && " 🧪 Practice mode: no real money."}
        </p>
      </div>
      {buys === 0 ? <EmptyBuys /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-2 text-lg font-bold">👥 Top groups</h2>
            {groups.length === 0 ? <p className="text-sm text-stone-400">No group buys yet. Share a market in your group to get started.</p> : (
              <ol className="divide-y divide-white/5 text-sm">
                {groups.map((g, i) => (
                  <li key={g.chat_id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate"><b className="mr-2 text-stone-500">{i + 1}</b>{g.title ?? "A Telegram group"}</span>
                    <span className="shrink-0 text-right text-stone-400">{pl(g.wallets, "wallet")} · {fmtUsd(g.volume)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-lg font-bold">🙋 Top people</h2>
            <ol className="divide-y divide-white/5 text-sm">
              {people.map((p, i) => (
                <li key={p.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate"><b className="mr-2 text-stone-500">{i + 1}</b>{p.name}</span>
                  <span className="shrink-0 text-right text-stone-400">
                    {p.buys > 0 ? `${pl(p.buys, "buy")} · ${fmtUsd(p.volume)}` : ""}{p.brought > 0 ? `${p.buys > 0 ? " · " : ""}brought ${pl(p.brought, "wallet")}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-stone-500">People show by Telegram username once they link a wallet with /link in the bot; otherwise by a short wallet address.</p>
          </section>
        </div>
      )}
    </div>
  );
}
