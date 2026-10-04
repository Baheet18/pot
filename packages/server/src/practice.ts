import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { parsePracticeMessage, PRACTICE_MAX_AGE_SEC, practiceMessage, type PracticeAction } from "@pot/core";
import { FlowError } from "./flows";
import { SANDBOX } from "./settings";

export function newPracticeMessage(action: PracticeAction, wallet: string, marketId: string, detail: string, ref: string) {
  return practiceMessage({ action, wallet, marketId, detail, ref, ts: Math.floor(Date.now() / 1000) });
}

/**
 * Checks a practice-mode wallet signature (ed25519 over the exact message) and returns a deterministic
 * `sandbox_…` id used in place of a transaction signature. Only valid in test mode.
 */
export function verifyPractice(input: { message: string; signature: string; wallet: string; action: PracticeAction; marketId: string; ref: string; now?: number }): string {
  if (!SANDBOX) throw new FlowError(403, "NOT_PRACTICE", "Practice signatures are only accepted in test mode.");
  const f = parsePracticeMessage(input.message);
  if (!f) throw new FlowError(400, "BAD_PRACTICE", "That isn't a Pot practice message.");
  if (f.action !== input.action || f.wallet !== input.wallet || f.marketId !== input.marketId || f.ref !== input.ref)
    throw new FlowError(400, "BAD_PRACTICE", "The practice message doesn't match this order.");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (now - f.ts > PRACTICE_MAX_AGE_SEC || f.ts - now > 120) throw new FlowError(400, "PRACTICE_EXPIRED", "This practice confirmation expired. Try again.");
  let sig: Uint8Array, pk: Uint8Array;
  try { sig = bs58.decode(input.signature); pk = new PublicKey(input.wallet).toBytes(); } catch { throw new FlowError(400, "BAD_SIGNATURE", "Bad signature"); }
  if (sig.length !== 64 || !nacl.sign.detached.verify(new TextEncoder().encode(input.message), sig, pk))
    throw new FlowError(401, "BAD_SIGNATURE", "The wallet signature doesn't match.");
  return `sandbox_${createHash("sha256").update(sig).digest("base64url").slice(0, 24)}`;
}
