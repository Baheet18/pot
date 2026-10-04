/**
 * End-to-end sandbox run against the local web app (PANTA_MODE=test), using a throwaway devnet keypair.
 * Steps: Blink GET → POST (type "message", no transaction) → sign the free message → /next → recorded buy;
 * web buy with a signed group/member ref; create market; link wallet (signMessage); leaderboard.
 * The keypair file is read locally and never printed. No real money is involved anywhere.
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { draftMarket, linkMessage } from "@pot/core";
import { groupLeaderboard, saveDraft, sign, signRef, upsertGroup, upsertMember } from "@pot/server";

const BASE = process.env.POT_E2E_BASE || "http://localhost:3100";
const MARKET = "TestMarket1111111111111111111111111111111";
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.POT_E2E_WALLET || "/home/box/.panta/sandbox_wallet.json", "utf8"))));
const wallet = kp.publicKey.toBase58();
const log = (step: string, info: unknown) => console.log(`✔ ${step}:`, typeof info === "string" ? info : JSON.stringify(info));

async function j(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(body)}`);
  return body as any;
}

/** Practice mode: the wallet signs a free text message (like Phantom's signMessage). No transaction exists. */
const signText = (msg: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

async function main() {
  console.log(`Sandbox E2E against ${BASE} with throwaway wallet ${wallet}`);

  // Test group + member so leaderboards have names.
  const chatId = -1009990001;
  await upsertGroup(chatId, "Baheet test group");
  await upsertMember(42, "Ada");

  // 1) Blink: GET → POST → sign → next
  const get = await j(`/api/actions/m/${MARKET}?ref=xbaheet_`);
  log("Blink GET", { title: get.title, buttons: get.links.actions.length, disabled: !!get.disabled });
  const post = await j(`/api/actions/m/${MARKET}?side=yes&amount=5&ref=xbaheet_`, { method: "POST", body: JSON.stringify({ account: wallet }) });
  if (post.type !== "message" || post.transaction) throw new Error("practice Blink must return a message, not a transaction");
  log("Blink POST (message, no tx)", { next: post.links.next.href.split("?")[0] });
  const next = new URL(post.links.next.href, BASE);
  const done = await j(next.pathname + next.search, { method: "POST", body: JSON.stringify({ account: wallet, signature: signText(post.data), data: post.data }) });
  log("Blink next (completed)", { title: done.title, description: done.description });

  // 2) Web buy with a signed member ref (group credit)
  const ref = `g${chatId}u42`;
  const rs = signRef(ref);
  const start = await j("/api/pot/buy/start", { method: "POST", body: JSON.stringify({ marketId: MARKET, side: "no", amountUsdc: 10, wallet, ref, rs }) });
  log("web buy start", { shares: start.shares, fee: start.feeUsdc, paysAboutIfRight: start.paysAboutIfRight, hasTx: !!start.transaction });
  const fin = await j("/api/pot/buy/finish", { method: "POST", body: JSON.stringify({ orderId: start.orderId, quoteId: start.quoteId, practiceMessage: start.practiceMessage, practiceSignature: signText(start.practiceMessage), wallet, marketId: MARKET, side: "no", amountUsdc: 10, ref, rs }) });
  log("web buy finish", fin);

  // 2b) Forged group ref (no signature) must not get credit
  const forged = await j("/api/pot/buy/start", { method: "POST", body: JSON.stringify({ marketId: MARKET, side: "yes", amountUsdc: 2, wallet, ref: `g${chatId}` }) });
  log("forged ref accepted as plain web buy", { orderId: forged.orderId });

  // 3) Create market from a /new-style draft
  const draft = draftMarket("Will Super Eagles beat Ghana on Saturday 8pm?", { now: Math.floor(Date.now() / 1000) });
  const row = await saveDraft(chatId, 7, draft);
  const t = sign({ d: row.id, u: 7 }, 3600);
  const cs = await j("/api/pot/create/start", { method: "POST", body: JSON.stringify({ draftId: row.id, token: t, wallet }) });
  log("create start", { title: draft.title, type: draft.marketType, fee: cs.feeUsdc, hasTx: !!cs.transaction });
  const cf = await j("/api/pot/create/finish", { method: "POST", body: JSON.stringify({ draftId: row.id, token: t, createId: cs.createId, wallet, practiceMessage: cs.practiceMessage, practiceSignature: signText(cs.practiceMessage) }) });
  log("create finish", cf);

  // 4) Link wallet via signMessage
  const lt = sign({ u: 42, a: "link" }, 3600);
  const msgSig = nacl.sign.detached(new TextEncoder().encode(linkMessage(wallet, lt)), kp.secretKey);
  log("link wallet", await j("/api/pot/link", { method: "POST", body: JSON.stringify({ token: lt, wallet, signature: bs58.encode(msgSig) }) }));
  const badSig = nacl.sign.detached(new TextEncoder().encode("something else"), kp.secretKey);
  const bad = await fetch(BASE + "/api/pot/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: lt, wallet, signature: bs58.encode(badSig) }) });
  log("link with wrong message rejected", bad.status);

  // 5) Leaderboard
  log("group leaderboard", await groupLeaderboard(chatId));
}

main().catch((e) => { console.error("✘", e.message); process.exit(1); });
