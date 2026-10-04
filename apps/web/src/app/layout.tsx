import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { PoweredByPanta } from "@/components/PoweredByPanta";
import { SANDBOX } from "@/lib/ui";
import { WEB_URL } from "@pot/server";

export const metadata: Metadata = {
  metadataBase: new URL(WEB_URL),
  title: "Pot · group predictions on Panta",
  description: "Your Telegram group makes the market, everyone buys in, the group earns the creator royalty. Every card shows whether the odds mean anything.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {SANDBOX && <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-black">🧪 Practice mode: no real money. Markets made here are practice markets, and your wallet only signs free messages, never payments.</div>}
        <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-xl font-black tracking-tight">🍯 Pot</Link>
          <nav className="flex items-center gap-4 text-sm text-stone-300">
            <Link href="/leaderboard">Leaderboard</Link>
            <a href="https://t.me/pantapotbot" target="_blank" rel="noopener noreferrer" className="hidden sm:inline">Telegram bot</a>
            <PoweredByPanta />
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-16">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-stone-500">
          Verdicts are an independent reading of Panta&apos;s public data, not advice. Payouts are estimates from the pool and change as people buy. <PoweredByPanta className="ml-2" />
        </footer>
      </body>
    </html>
  );
}
