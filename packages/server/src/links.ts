import { blinkUrl, formatRef, type Ref } from "@pot/core";
import { CLUSTER, WEB_URL } from "./settings";
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
export const blinkFor = (marketId: string, ref: Ref) => blinkUrl(actionUrl(marketId, ref), CLUSTER);
export const isPublicHttps = () => WEB_URL.startsWith("https://");
