"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletProviders } from "./WalletProviders";
import { OpenInPhantom } from "./OpenInPhantom";
import { api, signSendConfirm } from "./sign";

type Side = "yes" | "no";
interface Start { orderId: string; quoteId: string; side: Side; amountUsdc: number; shares: number; feeUsdc: number; paysAboutIfRight: number | null; transaction: string; sandbox: boolean; sandboxMemo: boolean }
interface Finish { status: string; attributed: boolean; newToPanta: boolean; newToPot: boolean; recorded: boolean }
type Step = "idle" | "quoting" | "quoted" | "signing" | "finishing" | "done" | "error";

export interface BuyPanelProps { marketId: string; initialSide?: Side; refStr: string; rs: string | null; buyable: boolean; sandbox: boolean; liveWrites: boolean; rpc: string }

function Inner(p: BuyPanelProps) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [side, setSide] = useState<Side>(p.initialSide ?? "yes");
  const [amount, setAmount] = useState("5");
  const [step, setStep] = useState<Step>("idle");
  const [q, setQ] = useState<Start | null>(null);
  const [at, setAt] = useState(0);
  const [msg, setMsg] = useState("");
  const [res, setRes] = useState<Finish | null>(null);
  const [sig, setSig] = useState("");

  if (!p.buyable) return <p className="text-sm text-stone-400">Buying is closed: this market has left its buy-only phase. Graduated markets trade on the order book at <a className="underline" href="https://www.panta.market/">panta.market</a>.</p>;
  if (!p.sandbox && !p.liveWrites) return <p className="text-sm text-amber-200">Live buying is switched off in this preview build (Phase 1: no real money). The flow is built and tested on Panta&apos;s sandbox.</p>;

  async function quote() {
    if (!publicKey) return;
    setStep("quoting"); setMsg(""); setRes(null);
    try {
      const s = await api<Start>("/api/pot/buy/start", { marketId: p.marketId, side, amountUsdc: Number(amount), wallet: publicKey.toBase58(), ref: p.refStr, rs: p.rs });
      setQ(s); setAt(Date.now()); setStep("quoted");
    } catch (e) { setStep("error"); setMsg((e as Error).message); }
  }

  async function finish(signature: string) {
    if (!q || !publicKey) return;
    setStep("finishing"); setSig(signature);
    const f = await api<Finish>("/api/pot/buy/finish", { orderId: q.orderId, quoteId: q.quoteId, signature, wallet: publicKey.toBase58(), marketId: p.marketId, side: q.side, amountUsdc: q.amountUsdc, ref: p.refStr, rs: p.rs, channel: "web" });
    setRes(f); setStep(f.status === "confirmed" ? "done" : "error");
    if (f.status !== "confirmed") setMsg(`Panta reports the order as ${f.status}.`);
  }

  async function signAndBuy() {
    if (!q || !signTransaction) return;
    if (Date.now() - at > 45_000) { setMsg("Quote expired, getting a fresh one…"); return quote(); }
    try {
      setStep("signing");
      const signature = await signSendConfirm(connection, q.transaction, signTransaction);
      await finish(signature);
    } catch (e) { setStep("error"); setMsg((e as Error).message); }
  }

  async function simulate() {
    try { await finish(`sandbox_${Math.random().toString(36).slice(2, 14)}`); } catch (e) { setStep("error"); setMsg((e as Error).message); }
  }

  return (
    <div className="space-y-3">
      <OpenInPhantom />
      <div className="flex gap-2">
        {(["yes", "no"] as Side[]).map((s) => (
          <button key={s} onClick={() => { setSide(s); setQ(null); setStep("idle"); }}
            className={`flex-1 rounded-lg px-4 py-3 text-lg font-bold ${side === s ? (s === "yes" ? "bg-emerald-500 text-black" : "bg-rose-500 text-black") : "bg-white/5 text-stone-300"}`}>
            Buy {s.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {[2, 5, 10, 20].map((a) => (
          <button key={a} onClick={() => { setAmount(String(a)); setQ(null); setStep("idle"); }} className={`rounded-md px-3 py-1 text-sm ${amount === String(a) ? "bg-white/20" : "bg-white/5"}`}>${a}</button>
        ))}
        <input value={amount} onChange={(e) => { setAmount(e.target.value); setQ(null); setStep("idle"); }} inputMode="decimal" className="w-20 rounded-md bg-white/5 px-2 py-1 text-sm" aria-label="USDC amount" />
        <span className="text-xs text-stone-400">USDC</span>
      </div>
      {!publicKey ? <WalletMultiButton /> : (
        <div className="space-y-2">
          <div className="text-xs text-stone-400">Wallet {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}</div>
          {step !== "quoted" && step !== "done" && <button onClick={quote} disabled={step === "quoting"} className="w-full rounded-lg bg-amber-400 px-4 py-3 font-bold text-black disabled:opacity-50">{step === "quoting" ? "Getting quote…" : `Get quote for $${amount} ${side.toUpperCase()}`}</button>}
          {q && step === "quoted" && (
            <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <div>You pay <b>${q.amountUsdc.toFixed(2)}</b> (fee ${q.feeUsdc.toFixed(2)}) and get about <b>{q.shares.toFixed(2)}</b> {q.side.toUpperCase()} shares.</div>
              {q.paysAboutIfRight !== null && <div>If {q.side.toUpperCase()} is right, this pays about <b>${q.paysAboutIfRight.toFixed(2)}</b> <span className="text-stone-400">(estimate from the pool; changes as others buy)</span>.</div>}
              {q.sandbox && <div className="text-amber-200">🧪 Sandbox: signing sends a free devnet memo transaction{q.sandboxMemo ? "" : ""}; no USDC moves.</div>}
              <button onClick={signAndBuy} className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">Sign &amp; buy in wallet</button>
              {q.sandbox && <button onClick={simulate} className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm">Simulate without signing (sandbox)</button>}
            </div>
          )}
          {(step === "signing" || step === "finishing") && <div className="text-sm text-stone-300">{step === "signing" ? "Waiting for your wallet and the network…" : "Confirming with Panta…"}</div>}
          {step === "done" && res && (
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">
              ✅ Bought! Panta status: {res.status}. {res.attributed ? "Credited to your group/sharer." : ""} {res.newToPanta ? "🎉 Your first Panta trade." : ""}
              <div className="mt-1 break-all text-xs text-stone-400">Signature: {sig}</div>
            </div>
          )}
          {msg && <div className="text-sm text-rose-300">{msg}</div>}
        </div>
      )}
    </div>
  );
}

export function BuyPanel(p: BuyPanelProps) {
  return <WalletProviders rpc={p.rpc}><Inner {...p} /></WalletProviders>;
}
