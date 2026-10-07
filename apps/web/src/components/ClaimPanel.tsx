"use client";
import { friendlyWalletError } from "@pot/core/src/walleterr";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { WalletProviders } from "./WalletProviders";
import { api, signSendConfirm } from "./sign";
import { PracticeBanner } from "./PracticeBanner";
import bs58 from "bs58";

function Inner({ marketId, kind, sandbox, liveWrites }: { marketId: string; kind: "win" | "creator"; sandbox: boolean; liveWrites: boolean }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signMessage } = useWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!sandbox && !liveWrites) return <p className="text-sm text-amber-200">Live claims are switched off in this preview build.</p>;
  async function claim() {
    if (!publicKey) return;
    setBusy(true); setMsg("");
    try {
      const b = await api<{ transaction: string; practiceMessage: string | null; winningShares: string | null; claimableFeesUsdc: number | null }>("/api/pot/claim/build", { marketId, kind, wallet: publicKey.toBase58() });
      if (sandbox) {
        if (!b.practiceMessage || !signMessage) throw new Error("This wallet can't sign messages. Try Phantom.");
        const ps = bs58.encode(await signMessage(new TextEncoder().encode(b.practiceMessage)));
        await api("/api/pot/claim/report", { marketId, kind, wallet: publicKey.toBase58(), practiceMessage: b.practiceMessage, practiceSignature: ps });
        setMsg("✅ Practice claim confirmed. No real money moved.");
        return;
      }
      if (!signTransaction || !b.transaction) throw new Error("Nothing to sign.");
      const sig = await signSendConfirm(connection, b.transaction, signTransaction);
      if (kind === "win") await api("/api/pot/claim/report", { marketId, wallet: publicKey.toBase58(), signature: sig }).catch(() => undefined);
      setMsg(`✅ Claimed. Signature ${sig}`);
    } catch (e) { setMsg(friendlyWalletError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      {sandbox && <PracticeBanner what="Claims here are a rehearsal. Your wallet signs a free message; nothing is paid out." />}
      {!publicKey ? <WalletMultiButton /> : <button disabled={busy} onClick={claim} className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-black disabled:opacity-50">{busy ? "Working…" : kind === "win" ? "Claim my winnings" : "Claim creator royalty"}</button>}
      {msg && <div className="break-all text-sm">{msg}</div>}
    </div>
  );
}
export function ClaimPanel(p: { marketId: string; kind: "win" | "creator"; sandbox: boolean; liveWrites: boolean; rpc: string }) {
  return <WalletProviders rpc={p.rpc}><Inner {...p} /></WalletProviders>;
}
