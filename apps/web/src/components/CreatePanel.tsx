"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletProviders } from "./WalletProviders";
import { OpenInPhantom } from "./OpenInPhantom";
import { api, signSendConfirm } from "./sign";

interface Start { createId: string; expectedMarketId: string; feeUsdc: number; transaction: string; sandbox: boolean }

function Inner({ draftId, token, sandbox, liveWrites, fee }: { draftId: string; token: string; sandbox: boolean; liveWrites: boolean; fee: number }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [s, setS] = useState<Start | null>(null);
  const [state, setState] = useState<"idle" | "quoting" | "ready" | "signing" | "registering" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [marketId, setMarketId] = useState("");
  if (!sandbox && !liveWrites) return <p className="text-sm text-amber-200">Live market creation is switched off in this preview build (Phase 1: no real money). The flow works on Panta&apos;s sandbox.</p>;

  async function start() {
    if (!publicKey) return;
    setState("quoting"); setMsg("");
    try { setS(await api<Start>("/api/pot/create/start", { draftId, token, wallet: publicKey.toBase58() })); setState("ready"); }
    catch (e) { setState("error"); setMsg((e as Error).message); }
  }
  async function register(signature: string) {
    if (!s) return;
    setState("registering");
    const r = await api<{ marketId: string }>("/api/pot/create/finish", { draftId, token, createId: s.createId, signature });
    setMarketId(r.marketId); setState("done");
  }
  async function signPay() {
    if (!s || !signTransaction) return;
    try {
      if (!s.transaction) throw new Error("Panta returned no transaction to sign.");
      setState("signing");
      await register(await signSendConfirm(connection, s.transaction, signTransaction));
    } catch (e) { setState("error"); setMsg((e as Error).message); }
  }
  return (
    <div className="space-y-3">
      <OpenInPhantom />
      {!publicKey ? <WalletMultiButton /> : (
        <>
          <div className="text-xs text-stone-400">Creator wallet {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)} (royalties go here)</div>
          {state === "idle" || state === "error" ? <button onClick={start} className="w-full rounded-lg bg-amber-400 px-4 py-3 font-bold text-black">Get creation quote (${fee})</button> : null}
          {s && state === "ready" && (
            <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <div>Panta fee: <b>${s.feeUsdc.toFixed(2)} USDC</b>. Part of it seeds both sides of the pot.</div>
              {s.sandbox && !s.transaction && <div className="text-amber-200">🧪 Sandbox returns no real transaction, so simulate the payment.</div>}
              {s.transaction && <button onClick={signPay} className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">Sign &amp; pay in wallet</button>}
              {s.sandbox && <button onClick={() => register(`sandbox_${Math.random().toString(36).slice(2, 14)}`).catch((e) => { setState("error"); setMsg((e as Error).message); })} className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm">Simulate payment (sandbox)</button>}
            </div>
          )}
          {state === "signing" && <div className="text-sm">Waiting for wallet + network…</div>}
          {state === "registering" && <div className="text-sm">Registering with Panta…</div>}
          {state === "done" && <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">✅ Market created: <a className="underline" href={`/m/${marketId}`}>{marketId}</a>. The bot will post the card in your group.</div>}
          {msg && <div className="text-sm text-rose-300">{msg}</div>}
        </>
      )}
    </div>
  );
}
export function CreatePanel(p: { draftId: string; token: string; sandbox: boolean; liveWrites: boolean; fee: number; rpc: string }) {
  return <WalletProviders rpc={p.rpc}><Inner {...p} /></WalletProviders>;
}
