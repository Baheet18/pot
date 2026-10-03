import { createHmac, timingSafeEqual } from "node:crypto";
import { hmacSecret } from "./secrets";

/**
 * Short signed tokens for links the bot hands out (wallet link, create-and-pay, member refs).
 * Format: base64url(json).sig — sig = first 16 bytes of HMAC-SHA256. Expiry enforced.
 */
export function sign(payload: Record<string, unknown>, ttlSec = 3600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  return `${body}.${mac(body)}`;
}
export function verify<T extends Record<string, unknown>>(token: string | null | undefined): T | null {
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, sig] = token.split(".");
  const expect = mac(body);
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof p.exp !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
const mac = (body: string) => createHmac("sha256", hmacSecret()).update(body).digest().subarray(0, 16).toString("base64url");

/** Ref signature so group/member credit in a link can't be forged (x/web refs are open). */
export const signRef = (ref: string) => createHmac("sha256", hmacSecret()).update("ref:" + ref).digest().subarray(0, 8).toString("base64url");
export function refIsTrusted(ref: string, rs: string | null | undefined): boolean {
  if (!ref.startsWith("g")) return true;
  if (!rs) return false;
  const e = signRef(ref);
  return rs.length === e.length && timingSafeEqual(Buffer.from(rs), Buffer.from(e));
}
