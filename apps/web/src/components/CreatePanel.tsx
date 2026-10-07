"use client";
import { friendlyWalletError } from "@pot/core/src/walleterr";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletProviders } from "./WalletProviders";
import { OpenInPhantom } from "./OpenInPhantom";
import { api, signSendConfirm } from "./sign";
import { PracticeBanner } from "./PracticeBanner";
import bs58 from "bs58";

interface Start { createId: string; expectedMarketId: string; feeUsdc: number; transaction: string; practiceMessage: string | null; sandbox: boolean }

function Inner({ draftId, token, sandbox, liveWrites, fee }: { draftId: string; token: string; sandbox: boolean; liveWrites: boolean; fee: number }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signMessage } = useWallet();
  const [s, setS] = useState<Start | null>(null);
  const [state, setState] = useState<"idle" | "quoting" | "ready" | "signing" | "registering" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [marketId, setMarketId] = useState("");
  if (!sandbox && !liveWrites) return <p className="text-sm text-amber-200">Live market creation is switched off in this preview build (Phase 1: no real money). The flow works on Panta&apos;s sandbox.</p>;

  async function start() {
    if (!publicKey) return;
    setState("quoting"); setMsg("");
    try { setS(await api<Start>("/api/pot/create/start", { draftId, token, wallet: publicKey.toBase58() })); setState("ready"); }
    catch (e) { setState("error"); setMsg(friendlyWalletError(e)); }
  }
  async function register(proof: { signature: string } | { practiceMessage: string; practiceSignature: string }) {
    if (!s || !publicKey) return;
    setState("registering");
    const r = await api<{ marketId: string }>("/api/pot/create/finish", { draftId, token, createId: s.createId, wallet: publicKey.toBase58(), ...proof });
    setMarketId(r.marketId); setState("done");
  }
  async function signPay() {
    if (!s || !signTransaction) return;
    try {
      if (!s.transaction) throw new Error("Panta returned no transaction to sign.");
      setState("signing");
      await register({ signature: await signSendConfirm(connection, s.transaction, signTransaction) });
    } catch (e) { setState("error"); setMsg(friendlyWalletError(e)); }
  }
  async function signPractice() {
    if (!s?.practiceMessage || !signMessage) { setState("error"); setMsg("This wallet can't sign messages. Try Phantom."); return; }
    try {
      setState("signing");
      const sig = await signMessage(new TextEncoder().encode(s.practiceMessage));
      await register({ practiceMessage: s.practiceMessage, practiceSignature: bs58.encode(sig) });
    } catch (e) { setState("error"); setMsg(friendlyWalletError(e)); }
  }
  return (
    <div className="space-y-3">
      {sandbox && <PracticeBanner what="Creating here is a rehearsal: no fee is charged. Your wallet signs a free message instead of paying." />}
      <OpenInPhantom />
      {!publicKey ? <WalletMultiButton /> : (
        <>
          <div className="text-xs text-stone-400">Creator wallet {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)} (royalties go here)</div>
          {state === "idle" || state === "error" ? <button onClick={start} className="w-full rounded-lg bg-amber-400 px-4 py-3 font-bold text-black">Get creation quote (${fee})</button> : null}
          {s && state === "ready" && (
            <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <div>Panta fee: <b>${s.feeUsdc.toFixed(2)} USDC</b>{s.sandbox ? " (practice: not charged)" : ""}. Part of it seeds both sides of the pot.</div>
              {s.sandbox
                ? <button onClick={signPractice} data-testid="confirm-practice-create" className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">✍️ Confirm practice market (free signature)</button>
                : s.transaction && <button onClick={signPay} className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black">Sign &amp; pay in wallet</button>}
            </div>
          )}
          {state === "signing" && <div className="text-sm">{sandbox ? "Approve the free message in your wallet…" : "Waiting for wallet + network…"}</div>}
          {state === "registering" && <div className="text-sm">Registering with Panta…</div>}
          {state === "done" && <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm">✅ {sandbox ? "Practice market created (no fee charged):" : "Market created:"} <a className="break-all underline" href={`/m/${marketId}`}>open the market page</a>. The bot will post the card in your group.</div>}
          {msg && <div className="text-sm text-rose-300">{msg}</div>}
        </>
      )}
    </div>
  );
}
export function CreatePanel(p: { draftId: string; token: string; sandbox: boolean; liveWrites: boolean; fee: number; rpc: string }) {
  return <WalletProviders rpc={p.rpc}><Inner {...p} /></WalletProviders>;
}
