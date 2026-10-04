import { fmtTime, fmtWat } from "@pot/core";
import { getDraft, groupTitle, verify } from "@pot/server";
import { CreatePanel } from "@/components/CreatePanel";
import { LIVE_WRITES, RPC_URL, SANDBOX, sp } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function CreatePage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { draftId } = await params;
  const token = sp((await searchParams).t) ?? "";
  const t = verify<{ d: string; u: number }>(token);
  const row = t && t.d === draftId ? await getDraft(draftId) : null;
  if (!row) return <div className="card mx-auto max-w-lg p-6"><h1 className="text-xl font-bold">This create link has expired</h1><p className="mt-2 text-stone-300">Go back to your group and tap ✅ Create again.</p></div>;
  const d = row.draft;
  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[1fr_340px]">
      <div className="card space-y-3 p-6">
        <div className="text-xs uppercase tracking-wide text-stone-400">New market for {await groupTitle(row.chat_id) ?? "your group"} · {d.marketType} · {d.category}</div>
        <h1 className="text-2xl font-black">{d.title}</h1>
        <p className="whitespace-pre-line text-sm text-stone-300">{d.resolutionRule}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-stone-400">Buying closes</span><br /><b>{fmtWat(d.startTime)}</b></div>
          <div><span className="text-stone-400">Event ends</span><br /><b>{fmtWat(d.endTime)}</b></div>
          <div><span className="text-stone-400">Resolves</span><br /><b>{fmtWat(d.resolutionTime)}</b></div>
          <div><span className="text-stone-400">Sources</span><br />{d.sourcesOfTruth.map((s) => <div key={s} className="truncate">{s.replace(/^https?:\/\//, "")}</div>)}</div>
        </div>
        {row.status === "created" && row.market_id && <p className="rounded bg-emerald-500/10 p-2 text-sm">Already created: <a className="underline" href={`/m/${row.market_id}`}>open market</a></p>}
        <p className="text-xs text-stone-500">Draft {draftId} · made {fmtTime(row.created_at)}</p>
      </div>
      <div className="card space-y-3 p-6">
        <h2 className="font-bold">Create & pay</h2>
        <p className="text-sm text-stone-300">You sign in your own wallet. The wallet that pays becomes the creator and receives the royalty when the market resolves.</p>
        {row.status !== "created" && <CreatePanel draftId={draftId} token={token} sandbox={SANDBOX} liveWrites={LIVE_WRITES} fee={d.marketType === "breaking" ? 20 : 50} rpc={RPC_URL} />}
      </div>
    </div>
  );
}
