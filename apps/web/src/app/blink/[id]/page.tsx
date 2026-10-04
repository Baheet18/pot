import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { actionGetFor, ogImageFor, signRef, WEB_URL } from "@pot/server";
import { sp } from "@/lib/ui";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await actionGetFor(id, null, null).catch(() => null);
  if (!r) return { title: "Blink not found · Pot" };
  const image = { url: ogImageFor(id), width: 1200, height: 630 };
  return { title: `Blink: ${r.payload.title} · Pot`, description: r.payload.description, openGraph: { title: r.payload.title, description: r.payload.description, images: [image] }, twitter: { card: "summary_large_image", images: [image.url] } };
}

/**
 * Our own Blink preview: renders the market's Solana Action GET (the same payload /api/actions/m/<id> serves)
 * the way a Blink-aware wallet would, so it can be demoed without any third-party interstitial.
 * Buttons open our market page with the side and amount filled in; signing happens there.
 */
export default async function BlinkPreview({ params, searchParams }: Props) {
  const { id } = await params;
  const q = await searchParams;
  const r = await actionGetFor(id, sp(q.ref) ?? null, sp(q.rs) ?? null).catch(() => null);
  if (!r) notFound();
  const a = r.payload;
  const host = new URL(WEB_URL).host;
  const rs = r.ref.startsWith("g") ? signRef(r.ref) : null;
  const refQs = (extra: Record<string, string>) => new URLSearchParams({ ...extra, ref: r.ref, ...(rs ? { rs } : {}) }).toString();
  const toPage = (href: string) => {
    const u = new URL(href, WEB_URL);
    return `/m/${id}?${refQs({ side: u.searchParams.get("side") ?? "yes", amount: u.searchParams.get("amount") ?? "5" })}`;
  };
  const actionApi = `${WEB_URL}/api/actions/m/${id}?${refQs({})}`;
  const buttons = (a.links?.actions ?? []).filter((x) => !x.parameters?.length);
  const custom = (a.links?.actions ?? []).find((x) => x.parameters?.length);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-black">Blink preview</h1>
        <p className="mt-1 text-sm text-stone-400">This is how Blink-aware wallets (Phantom, Backpack) show this market inside an X post. It&apos;s drawn from Pot&apos;s own Action API, so it works without dial.to.</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#16181c]" data-testid="blink-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.icon} alt="" className="aspect-square w-full object-cover" />
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-1 text-xs text-stone-400"><span>{host}</span><span className="rounded bg-sky-500/20 px-1.5 text-[10px] font-semibold text-sky-300">Pot</span></div>
          <h2 className="text-lg font-bold leading-snug">{a.title}</h2>
          <p className="text-sm text-stone-300">{a.description}</p>
          {a.disabled ? (
            <div className="rounded-full bg-white/10 py-2 text-center text-sm font-semibold text-stone-400">{a.label}</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {buttons.map((b) => (
                  <Link key={b.label} href={toPage(b.href)} className={`rounded-full py-2 text-center text-sm font-bold ${b.label.startsWith("NO") ? "bg-rose-500 text-black" : "bg-emerald-500 text-black"}`}>{b.label}</Link>
                ))}
              </div>
              {custom && (
                <form action={`/m/${id}`} className="flex gap-2">
                  <input type="hidden" name="side" value="yes" />
                  <input type="hidden" name="ref" value={r.ref} />
                  {rs && <input type="hidden" name="rs" value={rs} />}
                  <input name="amount" inputMode="decimal" placeholder={custom.parameters![0].label ?? "Amount"} className="min-w-0 flex-1 rounded-full border border-white/15 bg-transparent px-4 py-2 text-sm" />
                  <button className="rounded-full bg-sky-500 px-4 py-2 text-sm font-bold text-black">{custom.label}</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
      <div className="card space-y-2 p-4 text-xs text-stone-400">
        <p>Share the market link itself (not this page) on X: <span className="break-all font-mono text-stone-300">{`${WEB_URL}/m/${id}`}</span>. Our <a className="underline" href="/actions.json">actions.json</a> tells wallets that link is a Blink.</p>
        <p>Action API: <a className="break-all underline" href={actionApi}>{actionApi}</a></p>
        <details><summary className="cursor-pointer">Raw Action response</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px]">{JSON.stringify(a, null, 2)}</pre></details>
      </div>
    </div>
  );
}
