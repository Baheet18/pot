import { computeReceipt, formatReceiptHtml, PANTA_PRIMARY_FEE_RATE, type Receipt, type ReceiptBuy } from "@pot/core";
import { buyerNames, buysForMarket, walletOwnerNames } from "./store";
import type { MarketView } from "./views";

/**
 * Settlement receipt for a resolved market, from Pot's own buy log (Telegram names via linked wallets).
 * Pass chatId to list only that group's buyers (everyone else becomes one "outside this group" line).
 */
export async function buildReceipt(view: MarketView, opts: { chatId?: number } = {}): Promise<Receipt> {
  const rows = await buysForMarket(view.market.id);
  const buys: ReceiptBuy[] = rows
    .filter((b) => b.side === "yes" || b.side === "no")
    .map((b) => ({ signature: b.signature, wallet: b.wallet, side: b.side as "yes" | "no", amountUsdc: Number(b.amount_usdc), chatId: b.chat_id === null ? null : Number(b.chat_id) }));
  // Name order: the Telegram user who made this buy (bot links / "put my name on it"), then whoever linked the wallet.
  const perBuy = await buyerNames(buys.map((b) => b.signature));
  for (const b of buys) b.name = perBuy.get(b.signature) ?? null;
  const names = await walletOwnerNames([...new Set(buys.map((b) => b.wallet))]);
  return computeReceipt(view.market, view.payout, view.trades, buys, {
    names, practice: view.practice || view.sandbox, feeRate: view.practice || view.sandbox ? 0 : PANTA_PRIMARY_FEE_RATE, chatId: opts.chatId,
  });
}

export async function receiptMessage(view: MarketView, chatId: number): Promise<string> {
  return formatReceiptHtml(await buildReceipt(view, { chatId }));
}
