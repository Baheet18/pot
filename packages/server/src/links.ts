import { formatRef, xIntentUrl, type Ref } from "@pot/core";
import { WEB_URL } from "./settings";
import { signRef } from "./tokens";

/** URLs the bot and pages hand out. Group/member refs are HMAC-signed so credit can't be forged. */
export function refQuery(ref: Ref): string {
  const r = formatRef(ref);
  const q = new URLSearchParams({ ref: r });
  if (r.startsWith("g")) q.set("rs", signRef(r));
  return q.toString();
}
export const marketUrl = (marketId: string, ref: Ref, side?: "yes" | "no") =>
  `${WEB_URL}/m/${marketId}?${refQuery(ref)}${side ? `&side=${side}` : ""}`;
/** Opens the page inside Phantom's in-app browser on mobile (wallet injected there). */
export const phantomBrowse = (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(WEB_URL)}`;
export const actionUrl = (marketId: string, ref: Ref) => `${WEB_URL}/api/actions/m/${marketId}?${refQuery(ref)}`;
/** The shareable Blink link is our own market page: actions.json maps /m/* to the Action API (no dial.to). */
export const blinkFor = (marketId: string, ref: Ref) => marketUrl(marketId, ref);
/** Our own Blink preview page (renders the Action GET like a wallet would). */
export const blinkPreviewFor = (marketId: string, ref: Ref) => `${WEB_URL}/blink/${marketId}?${refQuery(ref)}`;
/** X post intent with prefilled text and our market URL. */
export const xShareFor = (marketId: string, ref: Ref, text: string) => xIntentUrl(text, marketUrl(marketId, ref));
/** Open Graph / Blink icon images rendered by /api/og/<id>. */
export const ogImageFor = (marketId: string, square = false) => `${WEB_URL}/api/og/${marketId}${square ? "?sq=1" : ""}`;
export const isPublicHttps = () => WEB_URL.startsWith("https://");
