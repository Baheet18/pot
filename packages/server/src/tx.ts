import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { RPC_URL, SANDBOX } from "./settings";

export interface PantaIx { programId: string; data: string; accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> }
export const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function toIx(i: PantaIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(i.programId),
    data: Buffer.from(i.data, "base64"),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  });
}

let conn: Connection | null = null;
export const connection = () => (conn ??= new Connection(RPC_URL, "confirmed"));

/**
 * Compile Panta's instruction list into an unsigned v0 transaction (base64) for the payer to sign.
 * Live mode only: compiles Panta's instructions exactly as built into a v0 transaction for the user's wallet.
 */
export async function compileTx(opts: { payer: string; instructions: PantaIx[]; recentBlockhash: string; memo?: string }): Promise<{ tx: string; blockhash: string; sandboxMemo: boolean }> {
  // Practice mode never builds transactions for a wallet (see practice.ts). Hard stop, not a convention.
  if (SANDBOX) throw new Error("No transactions are built in practice (test) mode.");
  const payer = new PublicKey(opts.payer);
  const ixs = opts.instructions.map(toIx);
  const blockhash = opts.recentBlockhash;
  // Live: Panta's instructions are used exactly as built (no extra instructions), so its fail-closed verification matches.
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return { tx: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"), blockhash, sandboxMemo: false };
}

export const isSignature = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s);
export const isSandboxSignature = (s: string) => /^sandbox_[A-Za-z0-9_-]{6,40}$/.test(s);
export const isWallet = (s: string) => {
  try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && PublicKey.isOnCurve(new PublicKey(s).toBytes()); } catch { return false; }
};
export const isMarketId = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
