import { estimateBuyPayout, parseRef, pantaUserId, refGroup, toCreateQuoteBody, validateDraft, type MarketDraft } from "@pot/core";
import { randomBytes } from "node:crypto";
import { getMarketView } from "./views";
import { getWalletTrades, invalidate, pantaPost, PantaError } from "./panta";
import { compileTx, isSandboxSignature, isSignature, isWallet, isMarketId, type PantaIx } from "./tx";
import { getDraft, linkGroupMarket, recordBuy, updateDraft } from "./store";
import { refIsTrusted } from "./tokens";
import { DEFAULT_MARKET_IMAGE, SANDBOX } from "./settings";

/**
 * Server-side flows shared by web pages, Blink actions and the bot.
 * The user always signs in their own wallet; the server never holds a user key.
 */
export class FlowError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const bad = (code: string, msg: string) => new FlowError(400, code, msg);

export function resolveRef(ref: string | null | undefined, rs: string | null | undefined) {
  const parsed = parseRef(ref);
  // Unsigned group refs are downgraded to "web" so nobody can claim a group's credit.
  if (!parsed || !refIsTrusted(ref!, rs)) return { ref: "web", parsed: parseRef("web")!, userId: pantaUserId(null) };
  return { ref: ref!, parsed, userId: pantaUserId(parsed) };
}

export interface StartBuyResult {
  orderId: string; quoteId: string; side: "yes" | "no"; amountUsdc: number; shares: number; feeUsdc: number;
  instructions: PantaIx[]; recentBlockhash: string; lastValidBlockHeight: number; sandbox: boolean;
  paysAboutIfRight: number | null; userId: string; transaction: string; sandboxMemo: boolean;
}

export async function startBuy(input: { marketId: string; side: string; amountUsdc: number; wallet: string; ref?: string | null; rs?: string | null }): Promise<StartBuyResult> {
  const { marketId, wallet } = input;
  if (!isMarketId(marketId) && !(SANDBOX && marketId.startsWith("TestMarket"))) throw bad("BAD_MARKET", "Bad market id");
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet address");
  const side = input.side === "no" ? "no" : input.side === "yes" ? "yes" : null;
  if (!side) throw bad("BAD_SIDE", "side must be yes or no");
  const amount = Math.round(input.amountUsdc * 100) / 100;
  if (!(amount >= 1 && amount <= 500)) throw bad("BAD_AMOUNT", "Amount must be between $1 and $500");
  const view = await getMarketView(marketId);
  if (!view.buyable) throw new FlowError(409, "NOT_BUYABLE", "This market is not in its buy-only phase, so it can't be bought through the API.");
  const { userId } = resolveRef(input.ref, input.rs);
  const q = await pantaPost<{ quoteId: string; shares: string; feeUsdc: string }>("/primaryorderquote/", { wallet, marketId, side, amountUsdc: amount.toFixed(2) }, { userId });
  const b = await pantaPost<{ orderId: string; instructions: PantaIx[]; recentBlockhash: string; lastValidBlockHeight: number; expectedShares?: string }>(
    "/primaryorderbuild/", { quoteId: q.quoteId, wallet, maxSlippageBps: 100 }, { userId });
  const shares = Number(b.expectedShares ?? q.shares) || 0;
  const pays = estimateBuyPayout(view.market, side, amount, shares);
  const c = await compileTx({ payer: wallet, instructions: b.instructions ?? [], recentBlockhash: b.recentBlockhash, memo: `pot sandbox buy ${side} ${amount} ${b.orderId}` });
  return {
    transaction: c.tx, sandboxMemo: c.sandboxMemo,
    orderId: b.orderId, quoteId: q.quoteId, side, amountUsdc: amount, shares, feeUsdc: Number(q.feeUsdc) || 0,
    instructions: b.instructions ?? [], recentBlockhash: b.recentBlockhash, lastValidBlockHeight: b.lastValidBlockHeight ?? 0,
    sandbox: SANDBOX, paysAboutIfRight: pays?.total ?? null, userId,
  };
}

export const sandboxSignature = () => `sandbox_${randomBytes(12).toString("base64url")}`;

export async function finishBuy(input: {
  orderId: string; signature: string; wallet: string; marketId: string; side: "yes" | "no"; amountUsdc: number; quoteId?: string;
  ref?: string | null; rs?: string | null; channel: "web" | "blink" | "telegram";
}) {
  const { orderId, signature, wallet, marketId } = input;
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(orderId)) throw bad("BAD_ORDER", "Bad order id");
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet");
  if (!(isSignature(signature) || (SANDBOX && isSandboxSignature(signature)))) throw bad("BAD_SIGNATURE", "Bad signature");
  const { ref, parsed, userId } = resolveRef(input.ref, input.rs);

  await pantaPost("/primaryordersubmit/", { orderId, signature, wallet });
  let status = "submitted";
  for (let i = 0; i < 10; i++) {
    const v = await pantaPost<{ status: string }>("/primaryorderverify/", { orderId, signature, wallet });
    status = v.status;
    if (status === "confirmed" || status === "failed" || status === "expired") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  let attributed = false;
  if (status === "confirmed") {
    try {
      const r = await pantaPost<{ status: string }>("/trades/", { signature, wallet, marketId, quoteId: input.quoteId, clientOrderId: orderId }, { userId });
      attributed = r.status === "processed" || r.status === "attributed";
    } catch (e) {
      if (!(e instanceof PantaError)) throw e;
    }
  }
  // "New to Panta": no earlier Panta trade for this wallet (other than this one).
  let newToPanta = false;
  try {
    const prior = (await getWalletTrades(wallet)).filter((t) => t.signature !== signature);
    newToPanta = prior.length === 0;
  } catch { /* unknown → not counted */ }
  const chatId = refGroup(parsed);
  const rec = status === "confirmed"
    ? recordBuy({
        signature, marketId, wallet, side: input.side, amountUsdc: input.amountUsdc, ref, pantaUserId: userId, chatId,
        sharerTgId: parsed.kind === "member" ? parsed.userId : null, sharerX: parsed.kind === "x" ? parsed.handle : null,
        newToPanta, pantaStatus: status, attributed, channel: input.channel,
      })
    : { inserted: false, newToPot: false };
  invalidate(`/markets/${marketId}/`);
  return { status, attributed, newToPanta, newToPot: rec.newToPot, recorded: rec.inserted, sandbox: SANDBOX };
}

// ---------------------------------------------------------------- create market (admin signs + pays)
export async function startCreate(draftId: string, wallet: string) {
  const row = getDraft(draftId);
  if (!row) throw new FlowError(404, "NO_DRAFT", "Draft not found");
  if (row.status === "created") throw new FlowError(409, "ALREADY_CREATED", "This market was already created");
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet");
  const problems = validateDraft(row.draft);
  if (problems.length) throw bad("BAD_DRAFT", problems.join("; "));
  const q = await pantaPost<{ createId: string; expectedEventPda: string; paymentUsdc: string }>(
    "/markets/create/quote/", toCreateQuoteBody(row.draft, wallet, DEFAULT_MARKET_IMAGE), { userId: `pot:g${row.chat_id}` });
  const b = await pantaPost<{ transaction: string; recentBlockhash: string; lastValidBlockHeight: number }>("/markets/create/build/", { createId: q.createId, wallet });
  updateDraft(draftId, { creator_wallet: wallet, status: "building" });
  // Sandbox returns an empty transaction; swap in a free devnet memo so the sign → send path still runs.
  let transaction = b.transaction;
  if (SANDBOX && !transaction) transaction = (await compileTx({ payer: wallet, instructions: [], recentBlockhash: b.recentBlockhash ?? "", memo: `pot sandbox create ${q.createId}` })).tx;
  return { createId: q.createId, expectedMarketId: q.expectedEventPda, feeUsdc: Number(q.paymentUsdc) / 1e6, transaction, lastValidBlockHeight: b.lastValidBlockHeight, sandbox: SANDBOX };
}

export async function finishCreate(draftId: string, createId: string, signature: string) {
  const row = getDraft(draftId);
  if (!row) throw new FlowError(404, "NO_DRAFT", "Draft not found");
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(createId)) throw bad("BAD_CREATE", "Bad create id");
  if (!(isSignature(signature) || (SANDBOX && isSandboxSignature(signature)))) throw bad("BAD_SIGNATURE", "Bad signature");
  const r = await pantaPost<{ marketId: string; status: string }>("/markets/register/", { createId, signature });
  updateDraft(draftId, { status: "created", market_id: r.marketId, create_signature: signature });
  linkGroupMarket(row.chat_id, r.marketId, { createdByGroup: true, draftId, creatorWallet: row.creator_wallet ?? undefined });
  return { marketId: r.marketId, chatId: row.chat_id, sandbox: SANDBOX };
}

// ---------------------------------------------------------------- claims
export async function buildClaim(kind: "win" | "creator", wallet: string, marketId: string) {
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet");
  const p = kind === "win" ? "/claim/build/" : "/claim/creator-fees/build/";
  const r = await pantaPost<{ instructions: PantaIx[]; recentBlockhash: string; winningShares?: string; claimableFeesUsdc?: string }>(p, { wallet, marketId });
  const c = await compileTx({ payer: wallet, instructions: r.instructions ?? [], recentBlockhash: r.recentBlockhash, memo: `pot sandbox ${kind} claim` });
  return { transaction: c.tx, sandboxMemo: c.sandboxMemo, winningShares: r.winningShares ?? null, claimableFeesUsdc: r.claimableFeesUsdc ? Number(r.claimableFeesUsdc) / 1e6 : null, sandbox: SANDBOX };
}
export async function reportClaim(wallet: string, marketId: string, signature: string) {
  if (!isSignature(signature) && !(SANDBOX && isSandboxSignature(signature))) throw bad("BAD_SIGNATURE", "Bad signature");
  return pantaPost("/trades/", { signature, wallet, marketId }, { userId: "pot:claim" });
}

export type { MarketDraft };
