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

/** Panta's on-chain program (the `programId` on every live market, seen 9 Oct 2026). Override with POT_PANTA_PROGRAM_IDS (comma-separated). */
export const PANTA_PROGRAM_ID = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";
/** The only programs a transaction Pot hands to a wallet may call. */
export const ALLOWED_PROGRAMS: ReadonlySet<string> = new Set([
  ...(process.env.POT_PANTA_PROGRAM_IDS ? process.env.POT_PANTA_PROGRAM_IDS.split(",").map((x) => x.trim()).filter(Boolean) : [PANTA_PROGRAM_ID]),
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "ComputeBudget111111111111111111111111111111", // Compute Budget
]);
export function assertAllowedPrograms(ixs: PantaIx[]) {
  for (const i of ixs) {
    if (!ALLOWED_PROGRAMS.has(i.programId)) throw new Error(`Refusing to build a transaction that calls an unexpected program (${i.programId.slice(0, 8)}…). Nothing was signed.`);
  }
}

/** Same check for a transaction Panta built itself (market creation): programs allowed, and the user's wallet pays the fee. */
export function assertTxAllowed(txBase64: string, payer: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  const keys = tx.message.staticAccountKeys; // invoked programs are always static keys (never in lookup tables)
  if (!keys[0]?.equals(new PublicKey(payer))) throw new Error("Refusing a transaction whose fee payer isn't your wallet. Nothing was signed.");
  for (const ci of tx.message.compiledInstructions) {
    const pid = keys[ci.programIdIndex]?.toBase58() ?? "?";
    if (!ALLOWED_PROGRAMS.has(pid)) throw new Error(`Refusing to pass on a transaction that calls an unexpected program (${pid.slice(0, 8)}…). Nothing was signed.`);
  }
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
  assertAllowedPrograms(opts.instructions);
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
