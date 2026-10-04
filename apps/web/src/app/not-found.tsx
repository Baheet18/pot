import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <h1 className="text-2xl font-black">Market not found</h1>
      <p className="mt-2 text-stone-300">This link doesn&apos;t point to a market we know. If it was a practice market, it may have been cleared.</p>
      <Link href="/" className="mt-4 inline-block rounded-lg bg-amber-400 px-4 py-2 font-bold text-black">See open markets</Link>
    </div>
  );
}
