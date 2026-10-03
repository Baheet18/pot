import { verify } from "@pot/server";
import { LinkPanel } from "@/components/LinkPanel";
import { RPC_URL, sp } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function LinkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = sp((await searchParams).t) ?? "";
  const ok = verify<{ u: number; a: string }>(token)?.a === "link";
  return (
    <div className="card mx-auto max-w-lg space-y-3 p-6">
      <h1 className="text-xl font-bold">Link your wallet to Telegram</h1>
      {ok ? <><p className="text-stone-300">Signing a message is free and moves no money. It lets the bot show your positions with /mine.</p><LinkPanel token={token} rpc={RPC_URL} /></>
          : <p className="text-stone-300">This link expired. Send /link to @pantapotbot again.</p>}
    </div>
  );
}
