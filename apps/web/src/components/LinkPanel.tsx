"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { WalletProviders } from "./WalletProviders";
import { OpenInPhantom } from "./OpenInPhantom";
import { api } from "./sign";
import { linkMessage } from "@pot/core";

function Inner({ token, message }: { token: string; message: (w: string) => string }) {
  const { publicKey, signMessage } = useWallet();
  const [msg, setMsg] = useState("");
  async function link() {
    if (!publicKey || !signMessage) return;
    try {
      const text = message(publicKey.toBase58());
      const sig = await signMessage(new TextEncoder().encode(text));
      await api("/api/pot/link", { token, wallet: publicKey.toBase58(), signature: bs58.encode(sig) });
      setMsg("✅ Linked. Go back to Telegram and send /mine.");
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="space-y-3">
      <OpenInPhantom />
      {!publicKey ? <WalletMultiButton /> : <button onClick={link} className="w-full rounded-lg bg-amber-400 px-4 py-3 font-bold text-black">Sign a free message to link {publicKey.toBase58().slice(0, 4)}…</button>}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
export function LinkPanel({ token, rpc }: { token: string; rpc: string }) {
  return <WalletProviders rpc={rpc}><Inner token={token} message={(w) => linkMessage(w, token)} /></WalletProviders>;
}
