"use client";
import { Connection, VersionedTransaction } from "@solana/web3.js";

export async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Sign a base64 v0 transaction in the wallet, broadcast it on our RPC and wait for confirmation. */
export async function signSendConfirm(connection: Connection, b64: string, signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  const bh = tx.message.recentBlockhash;
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, blockhash: bh, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
  return sig;
}
