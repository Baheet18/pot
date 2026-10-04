import { estimateBuyPayout, parseRef, pantaUserId, refGroup, toCreateQuoteBody, validateDraft, type MarketDraft } from "@pot/core";
import { randomBytes } from "node:crypto";
import { getMarketView } from "./views";
import { getWalletTrades, invalidate, pantaPost, PantaError } from "./panta";
import { compileTx, isSandboxSignature, isSignature, isWallet, isMarketId, type PantaIx } from "./tx";
import { getDraft, insertPracticeTrade, linkGroupMarket, recordBuy, updateDraft } from "./store";
import { refIsTrusted } from "./tokens";
import { DEFAULT_MARKET_IMAGE, SANDBOX } from "./settings";
import { newPracticeMessage, verifyPractice } from "./practice";
import { createPracticeMarket, practiceState, quotePractice } from "./practicemarket";

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
  paysAboutIfRight: number | null; userId: string;
  /** Live: base64 v0 tx to sign. Practice mode: always "" (wallet signs `practiceMessage` instead). */
  transaction: string; practiceMessage: string | null; sandboxMemo: boolean;
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
  if (view.practice) {
    // Practice market: quote against Pot's simulated pool; nothing goes to Panta or any chain.
    const st = (await practiceState(marketId))!;
    const { shares } = quotePractice(st.pool, side, amount);
    const pays = estimateBuyPayout(view.market, side, amount, shares);
    const orderId = `ord_p_${randomBytes(9).toString("base64url")}`;
    return {
      transaction: "", sandboxMemo: false, practiceMessage: newPracticeMessage("buy", wallet, marketId, `${side.toUpperCase()} $${amount.toFixed(2)}`, orderId),
      orderId, quoteId: orderId, side, amountUsdc: amount, shares, feeUsdc: 0, instructions: [], recentBlockhash: "", lastValidBlockHeight: 0,
      sandbox: true, paysAboutIfRight: pays?.total ?? null, userId,
    };
  }
  const q = await pantaPost<{ quoteId: string; shares: string; feeUsdc: string }>("/primaryorderquote/", { wallet, marketId, side, amountUsdc: amount.toFixed(2) }, { userId });
  const b = await pantaPost<{ orderId: string; instructions: PantaIx[]; recentBlockhash: string; lastValidBlockHeight: number; expectedShares?: string }>(
    "/primaryorderbuild/", { quoteId: q.quoteId, wallet, maxSlippageBps: 100 }, { userId });
  const shares = Number(b.expectedShares ?? q.shares) || 0;
  const pays = estimateBuyPayout(view.market, side, amount, shares);
  const transaction = SANDBOX ? "" : (await compileTx({ payer: wallet, instructions: b.instructions ?? [], recentBlockhash: b.recentBlockhash })).tx;
  const practiceMessage = SANDBOX ? newPracticeMessage("buy", wallet, marketId, `${side.toUpperCase()} $${amount.toFixed(2)}`, b.orderId) : null;
  return {
    transaction, practiceMessage, sandboxMemo: false,
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
    ? await recordBuy({
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
  const row = await getDraft(draftId);
  if (!row) throw new FlowError(404, "NO_DRAFT", "Draft not found");
  if (row.status === "created") throw new FlowError(409, "ALREADY_CREATED", "This market was already created");
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet");
  const problems = validateDraft(row.draft);
  if (problems.length) throw bad("BAD_DRAFT", problems.join("; "));
  if (SANDBOX) {
    // Practice market: no Panta call and no transaction. The admin signs a free message; Pot stores the market itself.
    await updateDraft(draftId, { creator_wallet: wallet, status: "building" });
    const createId = practiceCreateId(draftId);
    const fee = row.draft.creationFeeUsdc;
    return {
      createId, expectedMarketId: "", feeUsdc: fee, transaction: "", lastValidBlockHeight: 0, sandbox: true,
      practiceMessage: newPracticeMessage("create", wallet, row.draft.title.slice(0, 120), `fee $${fee.toFixed(2)} (practice, not charged)`, createId),
    };
  }
  const q = await pantaPost<{ createId: string; expectedEventPda: string; paymentUsdc: string }>(
    "/markets/create/quote/", toCreateQuoteBody(row.draft, wallet, DEFAULT_MARKET_IMAGE), { userId: `pot:g${row.chat_id}` });
  const b = await pantaPost<{ transaction: string; recentBlockhash: string; lastValidBlockHeight: number }>("/markets/create/build/", { createId: q.createId, wallet });
  await updateDraft(draftId, { creator_wallet: wallet, status: "building" });
  return { createId: q.createId, expectedMarketId: q.expectedEventPda, feeUsdc: Number(q.paymentUsdc) / 1e6, transaction: b.transaction, practiceMessage: null, lastValidBlockHeight: b.lastValidBlockHeight, sandbox: false };
}

export async function finishCreate(draftId: string, createId: string, signature: string) {
  const row = await getDraft(draftId);
  if (!row) throw new FlowError(404, "NO_DRAFT", "Draft not found");
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(createId)) throw bad("BAD_CREATE", "Bad create id");
  if (!(isSignature(signature) || (SANDBOX && isSandboxSignature(signature)))) throw bad("BAD_SIGNATURE", "Bad signature");
  const r = await pantaPost<{ marketId: string; status: string }>("/markets/register/", { createId, signature });
  await updateDraft(draftId, { status: "created", market_id: r.marketId, create_signature: signature });
  await linkGroupMarket(row.chat_id, r.marketId, { createdByGroup: true, draftId, creatorWallet: row.creator_wallet ?? undefined });
  return { marketId: r.marketId, chatId: row.chat_id, sandbox: SANDBOX };
}

// ---------------------------------------------------------------- claims
export async function buildClaim(kind: "win" | "creator", wallet: string, marketId: string) {
  if (!isWallet(wallet)) throw bad("BAD_WALLET", "Bad wallet");
  const p = kind === "win" ? "/claim/build/" : "/claim/creator-fees/build/";
  const r = await pantaPost<{ instructions: PantaIx[]; recentBlockhash: string; winningShares?: string; claimableFeesUsdc?: string }>(p, { wallet, marketId });
  const transaction = SANDBOX ? "" : (await compileTx({ payer: wallet, instructions: r.instructions ?? [], recentBlockhash: r.recentBlockhash })).tx;
  const practiceMessage = SANDBOX ? newPracticeMessage("claim", wallet, marketId, kind === "win" ? "winnings" : "creator royalty", `claim:${kind}`) : null;
  return { transaction, practiceMessage, sandboxMemo: false, winningShares: r.winningShares ?? null, claimableFeesUsdc: r.claimableFeesUsdc ? Number(r.claimableFeesUsdc) / 1e6 : null, sandbox: SANDBOX };
}
export async function reportClaim(wallet: string, marketId: string, signature: string) {
  if (!isSignature(signature) && !(SANDBOX && isSandboxSignature(signature))) throw bad("BAD_SIGNATURE", "Bad signature");
  return pantaPost("/trades/", { signature, wallet, marketId }, { userId: "pot:claim" });
}

export type { MarketDraft };

// ---------------------------------------------------------------- practice-mode finishers (wallet signed a free message)
export const practiceCreateId = (draftId: string) => `cr_p_${draftId.replace(/^d_/, "")}`;
export async function finishBuyPractice(input: Omit<Parameters<typeof finishBuy>[0], "signature"> & { practiceMessage: string; practiceSignature: string }) {
  const signature = verifyPractice({ message: input.practiceMessage, signature: input.practiceSignature, wallet: input.wallet, action: "buy", marketId: input.marketId, ref: input.orderId });
  const st = await practiceState(input.marketId);
  if (!st) return finishBuy({ ...input, signature });
  // Practice market: the signed message must match the order exactly; then record it in Pot's practice pool.
  const amount = Math.round(input.amountUsdc * 100) / 100;
  const detail = input.practiceMessage.split("\n").find((l) => l.startsWith("Detail: "))?.slice(8);
  if (detail !== `${input.side.toUpperCase()} $${amount.toFixed(2)}`) throw bad("BAD_PRACTICE", "The practice message doesn't match this order.");
  if (!(amount >= 1 && amount <= 500)) throw bad("BAD_AMOUNT", "Amount must be between $1 and $500");
  if (Math.floor(Date.now() / 1000) >= st.row.draft.startTime) throw new FlowError(409, "NOT_BUYABLE", "Buying has closed on this market.");
  const { ref, parsed, userId } = resolveRef(input.ref, input.rs);
  const rec = await recordBuy({
    signature, marketId: input.marketId, wallet: input.wallet, side: input.side, amountUsdc: amount, ref, pantaUserId: userId, chatId: refGroup(parsed),
    sharerTgId: parsed.kind === "member" ? parsed.userId : null, sharerX: parsed.kind === "x" ? parsed.handle : null,
    newToPanta: false, pantaStatus: "practice", attributed: parsed.kind !== "web", channel: input.channel,
  });
  if (rec.inserted) await insertPracticeTrade({ signature, marketId: input.marketId, wallet: input.wallet, side: input.side, amountUsdc: amount, shares: quotePractice(st.pool, input.side, amount).shares });
  return { status: "confirmed", attributed: parsed.kind !== "web", newToPanta: false, newToPot: rec.newToPot, recorded: rec.inserted, sandbox: true, practice: true };
}
export async function finishCreatePractice(draftId: string, createId: string, wallet: string, practiceMessage: string, practiceSignature: string) {
  const row = await getDraft(draftId);
  if (!row) throw new FlowError(404, "NO_DRAFT", "Draft not found");
  if (row.creator_wallet !== wallet) throw new FlowError(400, "BAD_WALLET", "Use the same wallet that started the creation.");
  if (row.status === "created") throw new FlowError(409, "ALREADY_CREATED", "This market was already created");
  if (createId !== practiceCreateId(draftId)) throw bad("BAD_CREATE", "Bad create id");
  const signature = verifyPractice({ message: practiceMessage, signature: practiceSignature, wallet, action: "create", marketId: row.draft.title.slice(0, 120), ref: createId });
  return createPracticeMarket(draftId, wallet, signature);
}
export function confirmClaimPractice(kind: "win" | "creator", wallet: string, marketId: string, practiceMessage: string, practiceSignature: string) {
  const signature = verifyPractice({ message: practiceMessage, signature: practiceSignature, wallet, action: "claim", marketId, ref: `claim:${kind}` });
  return { claimed: true, practice: true, signature };
}
