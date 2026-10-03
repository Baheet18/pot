import { getMarketView } from "@pot/server";
import { ClaimPanel } from "@/components/ClaimPanel";
import { LIVE_WRITES, RPC_URL, SANDBOX, sp } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const q = await searchParams;
  const kind = sp(q.kind) === "creator" ? "creator" : "win";
  const v = await getMarketView(id).catch(() => null);
  return (
    <div className="card mx-auto max-w-lg space-y-3 p-6">
      <h1 className="text-xl font-bold">{kind === "win" ? "Claim winnings" : "Claim creator royalty"}</h1>
      <p className="text-stone-300">{v?.market.title ?? id}</p>
      {v && kind === "creator" && <p className="text-sm text-stone-400">Estimated royalty: about ${v.royalty.estimatedUsdc.toFixed(2)} ({(v.royalty.royaltyBps / 100).toFixed(0)}%). {v.royalty.note}</p>}
      <ClaimPanel marketId={id} kind={kind} sandbox={SANDBOX} liveWrites={LIVE_WRITES} rpc={RPC_URL} />
    </div>
  );
}
