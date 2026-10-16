import { xIntentUrl } from "./actions";
import type { ReceiptResult } from "./receipt";

/** Receipt-sharing helpers: pure text/URL builders used by the web receipt and the bot receipt message. */
export interface ReceiptShareInput {
  title: string;
  outcome: "yes" | "no";
  practice: boolean;
  /** The sharer's own result, when known. "won" gets the brag line. */
  result?: ReceiptResult | null;
}

const clip = (t: string, max = 120) => (t.length > max ? t.slice(0, max - 3).replace(/\s+\S*$/, "") + "…" : t);

/** Short prefilled share text (the market URL is appended by the share target). */
export function receiptShareText(r: ReceiptShareInput): string {
  const head = r.result === "won" ? "I called it on Pot 🍯" : "Settled on Pot 🍯";
  const tail = r.practice ? " (practice market)" : "";
  return `${head} "${clip(r.title)}" resolved ${r.outcome.toUpperCase()}. See the receipt${tail}:`;
}

/** X post intent for a receipt. */
export const receiptXShareUrl = (r: ReceiptShareInput, url: string) => xIntentUrl(receiptShareText(r), url);

/** Telegram's share sheet (opens the chat picker with the link + text prefilled). */
export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?${new URLSearchParams({ url, text }).toString()}`;
}
