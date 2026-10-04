import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { linkMessage } from "@pot/core";
import { verify } from "./tokens";
import { linkWallet } from "./store";
import { FlowError } from "./flows";

/** Verify a wallet's signed link message (ed25519) against a bot-issued token, then store the link. */
export async function verifyAndLink(token: string, wallet: string, signatureB58: string) {
  const t = verify<{ u: number; a: string }>(token);
  if (!t || t.a !== "link" || typeof t.u !== "number") throw new FlowError(401, "BAD_TOKEN", "This link expired. Send /link to the bot again.");
  let pk: Uint8Array, sig: Uint8Array;
  try { pk = new PublicKey(wallet).toBytes(); sig = bs58.decode(signatureB58); } catch { throw new FlowError(400, "BAD_INPUT", "Bad wallet or signature"); }
  const ok = sig.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(linkMessage(wallet, token)), sig, pk);
  if (!ok) throw new FlowError(401, "BAD_SIGNATURE", "Signature does not match this wallet");
  await linkWallet(t.u, wallet);
  return { linked: true, tgUserId: t.u };
}
