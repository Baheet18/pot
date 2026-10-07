/**
 * Turns wallet / Solana errors (Phantom, Solflare, web3.js) into plain words. Server (Panta) messages are already friendly
 * and pass through unchanged.
 */
export function friendlyWalletError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const name = e instanceof Error ? e.name : "";
  const code = (e as { code?: number } | null)?.code;
  const t = `${name} ${raw}`;
  if (code === 4001 || /user rejected|rejected the request|declined|cancell?ed|WalletSignTransactionError.*reject|denied/i.test(t))
    return "You cancelled in your wallet. Nothing was sent or charged.";
  if (/insufficient lamports|insufficient funds for (fee|rent)|AccountNotFound.*fee|Attempt to debit an account but found no record of a prior credit/i.test(t))
    return "Not enough SOL for Solana network fees. Add about 0.01 SOL to the wallet and try again.";
  if (/insufficient funds|custom program error: 0x1\b|TokenInsufficientFunds/i.test(t))
    return "Not enough USDC in this wallet. Add USDC (Solana) and try again.";
  if (/blockhash not found|block height exceeded|TransactionExpired/i.test(t))
    return "The transaction expired before it landed. Nothing was charged. Get a fresh quote and sign again.";
  if (/WalletNotConnected|not connected/i.test(t)) return "Connect your wallet first.";
  if (/failed to fetch|network ?error|timed? ?out/i.test(t)) return "Network problem talking to Solana or Pot. Check your connection and try again.";
  return raw || "Something went wrong. Nothing was charged.";
}
