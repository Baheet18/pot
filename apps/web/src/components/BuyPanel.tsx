"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletProviders } from "./WalletProviders";
import { OpenInPhantom } from "./OpenInPhantom";
import { api, signSendConfirm } from "./sign";
import { PracticeBanner } from "./PracticeBanner";
import bs58 from "bs58";

type Side = "yes" | "no";
interface Start { orderId: string; quoteId: string; side: Side; amountUsdc: number; shares: number; feeUsdc: number; paysAboutIfRight: number | null; transaction: string; practiceMessage: string | null; sandbox: boolean }
interface Finish { status: string; attributed: boolean; newToPanta: boolean; newToPot: boolean; recorded: boolean }
type Step = "idle" | "quoting" | "quoted" | "signing" | "finishing" | "done" | "error";

export interface BuyPanelProps { marketId: string; initialSide?: Side; initialAmount?: number; refStr: string; rs: string | null; buyable: boolean; sandbox: boolean; liveWrites: boolean; rpc: string }

function Inner(p: BuyPanelProps) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signMessage } = useWallet();
  const router = useRouter();
  const [side, setSide] = useState<Side>(p.initialSide ?? "yes");
  const [amount, setAmount] = useState(String(p.initialAmount ?? 5));
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

  async function finish(proof: { signature: string } | { practiceMessage: string; practiceSignature: string }) {
    if (!q || !publicKey) return;
    setStep("finishing"); setSig("signature" in proof ? proof.signature : "practice (free message signature)");
    const f = await api<Finish>("/api/pot/buy/finish", { orderId: q.orderId, quoteId: q.quoteId, ...proof, wallet: publicKey.toBase58(), marketId: p.marketId, side: q.side, amountUsdc: q.amountUsdc, ref: p.refStr, rs: p.rs, channel: "web" });
    setRes(f); setStep(f.status === "confirmed" ? "done" : "error");
    if (f.status === "confirmed") router.refresh(); // show the updated pot and split
    if (f.status !== "confirmed") setMsg(`Panta reports the order as ${f.status}.`);
  }

  async function signAndBuy() {
    if (!q) return;
    if (Date.now() - at > 45_000) { setMsg("Quote expired, getting a fresh one…"); return quote(); }
    try {
      setStep("signing");
      if (q.sandbox) {
        // Practice mode: never a transaction. The wallet signs a free message; the server runs the sandbox submit.
        if (!q.practiceMessage || !signMessage) throw new Error("This wallet can't sign messages. Try Phantom.");
        const sigBytes = await signMessage(new TextEncoder().encode(q.practiceMessage));
        await finish({ practiceMessage: q.practiceMessage, practiceSignature: bs58.encode(sigBytes) });
      } else {
        if (!signTransaction || !q.transaction) throw new Error("Wallet can't sign this transaction.");
        await finish({ signature: await signSendConfirm(connection, q.transaction, signTransaction) });
      }
    } catch (e) { setStep("error"); setMsg((e as Error).message); }
  }

  return (
    <div className="space-y-3">
      {p.sandbox && <PracticeBanner />}
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
              {q.sandbox
                ? <button onClick={signAndBuy} data-testid="confirm-practice" className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">✍️ Confirm practice buy (free signature)</button>
                : <button onClick={signAndBuy} className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">Sign &amp; buy in wallet</button>}
            </div>
          )}
          {(step === "signing" || step === "finishing") && <div className="text-sm text-stone-300">{step === "signing" ? (p.sandbox ? "Approve the free message in your wallet…" : "Waiting for your wallet and the network…") : "Confirming with Panta…"}</div>}
          {step === "done" && res && (
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">
              ✅ {p.sandbox ? "Practice buy recorded. No real money moved. The pot above now includes it." : `Bought! Panta status: ${res.status}.`} {res.attributed ? "Credited to your group/sharer." : ""} {res.newToPanta ? "🎉 Your first Panta trade." : ""}
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
