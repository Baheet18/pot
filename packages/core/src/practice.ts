/**
 * Practice mode (PANTA_MODE=test): Panta's sandbox returns fixture transactions that can't land on any chain,
 * so Pot never asks a wallet to sign or send a transaction in practice mode. Instead the wallet signs this free
 * text message (no fee, nothing moves) and the server runs the sandbox submit path.
 */
export const PRACTICE_BANNER = "Practice mode: no real money";
export const PRACTICE_HEADER = "Pot practice";
export const PRACTICE_MAX_AGE_SEC = 15 * 60;

export type PracticeAction = "buy" | "create" | "claim";

export interface PracticeFields {
  action: PracticeAction;
  wallet: string;
  marketId: string;
  /** Free text, e.g. "YES $5.00 · order ord_x". Must be a single line. */
  detail: string;
  /** Binds the signature to one specific order / create / claim. */
  ref: string;
  ts: number;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 200);

export function practiceMessage(f: PracticeFields): string {
  return [
    `${PRACTICE_HEADER} ${f.action} (Panta test mode)`,
    "No real money moves. This is a free signature, not a transaction.",
    `Wallet: ${f.wallet}`,
    `Market: ${f.marketId}`,
    `Detail: ${oneLine(f.detail)}`,
    `Ref: ${oneLine(f.ref)}`,
    `Time: ${f.ts}`,
  ].join("\n");
}

export function parsePracticeMessage(msg: string): PracticeFields | null {
  const lines = msg.split("\n");
  if (lines.length !== 7) return null;
  const head = /^Pot practice (buy|create|claim) \(Panta test mode\)$/.exec(lines[0]);
  if (!head || lines[1] !== "No real money moves. This is a free signature, not a transaction.") return null;
  const get = (i: number, k: string) => (lines[i].startsWith(`${k}: `) ? lines[i].slice(k.length + 2) : null);
  const wallet = get(2, "Wallet"), marketId = get(3, "Market"), detail = get(4, "Detail"), ref = get(5, "Ref"), ts = Number(get(6, "Time"));
  if (!wallet || !marketId || detail === null || !ref || !Number.isFinite(ts)) return null;
  return { action: head[1] as PracticeAction, wallet, marketId, detail, ref, ts };
}
