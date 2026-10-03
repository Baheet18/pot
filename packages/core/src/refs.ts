/**
 * Attribution refs. Every buy link carries a ref saying who brought the buyer:
 *   g<chatId>            a Telegram group (chat ids are negative for groups)
 *   g<chatId>u<userId>   a member who shared the market from that group
 *   x<handle>            an X / Blink sharer
 *   web                  direct visit
 * The Panta attribution userId is "pot:" + ref.
 */
export type Ref =
  | { kind: "group"; chatId: number }
  | { kind: "member"; chatId: number; userId: number }
  | { kind: "x"; handle: string }
  | { kind: "web" };

const RE = /^(?:g(-?\d{1,20})(?:u(\d{1,20}))?|x([A-Za-z0-9_]{1,15})|web)$/;

export function formatRef(r: Ref): string {
  switch (r.kind) {
    case "group": return `g${r.chatId}`;
    case "member": return `g${r.chatId}u${r.userId}`;
    case "x": return `x${r.handle}`;
    default: return "web";
  }
}

export function parseRef(s: string | null | undefined): Ref | null {
  if (!s) return null;
  const m = s.trim().match(RE);
  if (!m) return null;
  if (m[1] !== undefined) {
    const chatId = Number(m[1]);
    if (!Number.isSafeInteger(chatId)) return null;
    if (m[2] !== undefined) {
      const userId = Number(m[2]);
      return Number.isSafeInteger(userId) ? { kind: "member", chatId, userId } : null;
    }
    return { kind: "group", chatId };
  }
  if (m[3] !== undefined) return { kind: "x", handle: m[3] };
  return { kind: "web" };
}

/** Panta `userId` for attribution (kept short; Panta ids are free text). */
export function pantaUserId(r: Ref | null): string {
  return `pot:${formatRef(r ?? { kind: "web" })}`.slice(0, 64);
}

/** The group a ref credits, if any (member refs also credit their group). */
export function refGroup(r: Ref | null): number | null {
  return r && (r.kind === "group" || r.kind === "member") ? r.chatId : null;
}

/** Normalise a user-typed X handle ("@Baheet_" → "Baheet_"); null if invalid. */
export function cleanHandle(h: string | null | undefined): string | null {
  const s = (h ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/** The exact text a user signs (free, off-chain) to link a wallet to their Telegram account. */
export const linkMessage = (wallet: string, token: string) =>
  `Pot: link wallet ${wallet} to my Telegram account.\nCode: ${token.slice(-16)}\nThis is free and does not move funds.`;
