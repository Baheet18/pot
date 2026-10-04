import { globalLeaderboard, groupTitle, totals } from "@pot/server";
import { fmtUsd } from "@pot/core";

export const dynamic = "force-dynamic";

export default async function Leaderboard() {
  const rows = await globalLeaderboard();
  const t = await totals();
  const titles = await Promise.all(rows.map((r) => (r.chat_id !== null ? groupTitle(r.chat_id) : Promise.resolve(null))));
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-black">Leaderboard</h1>
      <p className="text-stone-300">Ranked by people brought to Panta for the first time, then wallets, then money. {t.buys} buy{t.buys === 1 ? "" : "s"} from {t.wallets} wallet{t.wallets === 1 ? "" : "s"} so far.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-stone-400"><tr><th className="p-3">#</th><th>Source</th><th>New to Panta</th><th>Wallets</th><th>Buys</th><th>Money in</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-3 text-stone-400">No buys yet.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="p-3">{i + 1}</td>
                <td>{r.source === "group" ? `👥 ${titles[i] ?? "Group"}` : r.source === "x" ? `𝕏 @${r.sharer_x}` : "🌐 Website"}</td>
                <td><b>{r.new_to_panta}</b></td><td>{r.wallets}</td><td>{r.buys}</td><td>{fmtUsd(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
