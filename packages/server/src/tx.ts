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

// ---------------------------------------------------------------- live funds pre-check (read-only RPC; never blocks on RPC failure)
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** SOL a wallet should hold to pay network fees + Panta's position/receipt account rent. */
export const MIN_SOL = 0.005;
export interface WalletFunds { sol: number; usdc: number }
type FundsReader = (wallet: string) => Promise<WalletFunds | null>;
const rpcFunds: FundsReader = async (wallet) => {
  try {
    const owner = new PublicKey(wallet);
    const [lamports, toks] = await Promise.all([
      connection().getBalance(owner),
      connection().getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(USDC_MINT) }),
    ]);
    const usdc = toks.value.reduce((t, a) => t + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
    return { sol: lamports / 1e9, usdc };
  } catch { return null; }
};
let reader: FundsReader = rpcFunds;
export const readWalletFunds = (w: string) => reader(w);
/** Tests only. */
export const setFundsReader = (r: FundsReader | null) => { reader = r ?? rpcFunds; };
export function fundsProblem(f: WalletFunds | null, needUsdc: number): { code: string; message: string } | null {
  if (!f) return null; // RPC unavailable: let the wallet/Panta decide rather than block a good buyer
  if (f.usdc + 1e-9 < needUsdc) return { code: "INSUFFICIENT_USDC", message: `This wallet has $${f.usdc.toFixed(2)} USDC; this needs $${needUsdc.toFixed(2)} (including fees). Add USDC on Solana and try again.` };
  if (f.sol < MIN_SOL) return { code: "INSUFFICIENT_SOL", message: `This wallet has ${f.sol.toFixed(4)} SOL; keep at least ${MIN_SOL} SOL for Solana network fees. Add a little SOL and try again.` };
  return null;
}
