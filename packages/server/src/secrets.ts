import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Secrets are read at runtime (never inlined into a bundle) from, in order:
 *  1. chmod-600 files (local box / self-hosting; paths may come from env), or
 *  2. server-only encrypted env vars on Vercel: POT_PANTA_TEST_KEY, POT_PANTA_LIVE_KEY,
 *     POT_TELEGRAM_TOKEN, POT_HMAC_SECRET, POT_TELEGRAM_WEBHOOK_SECRET, POT_GEMINI_KEY.
 * Nothing here ever logs a secret value.
 */
const home = homedir();
export const SECRET_PATHS = {
  pantaLive: process.env.PANTA_KEY_FILE || path.join(home, ".panta", "api_key"),
  pantaTest: process.env.PANTA_TEST_KEY_FILE || path.join(home, ".panta", "test_key"),
  telegram: process.env.POT_TELEGRAM_TOKEN_FILE || path.join(home, ".pot", "telegram_token"),
  hmac: process.env.POT_HMAC_SECRET_FILE || path.join(home, ".pot", "hmac_secret"),
  gemini: process.env.POT_GEMINI_KEY_FILE || path.join(home, ".pot", "gemini_key"),
};

const memo = new Map<string, string>();

function readSecret(file: string, validate: (s: string) => boolean, label: string, envName?: string): string {
  const hit = memo.get(file);
  if (hit) return hit;
  if (!existsSync(/*turbopackIgnore: true*/ file)) {
    const v = envName ? process.env[envName]?.trim() : undefined;
    if (v) {
      if (!validate(v)) throw new Error(`${label} (env ${envName}) does not look valid.`);
      memo.set(file, v);
      return v;
    }
    throw new Error(`${label} not configured (file ${file} or env ${envName ?? "-"}).`);
  }
  checkPermissions(file, label);
  const v = readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
  if (!validate(v)) throw new Error(`${label} file ${file} does not look valid.`);
  memo.set(file, v);
  return v;
}

export function pantaKey(mode: "live" | "test"): string {
  return mode === "live"
    ? readSecret(SECRET_PATHS.pantaLive, (s) => /^pk_live_[A-Za-z0-9_-]+$/.test(s), "Panta live key", "POT_PANTA_LIVE_KEY")
    : readSecret(SECRET_PATHS.pantaTest, (s) => /^pk_test_[A-Za-z0-9_-]+$/.test(s), "Panta test key", "POT_PANTA_TEST_KEY");
}

export function telegramToken(): string | null {
  try {
    return readSecret(SECRET_PATHS.telegram, (s) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(s), "Telegram token", "POT_TELEGRAM_TOKEN");
  } catch {
    return null;
  }
}

/** HMAC secret for signed links; created (32 random bytes, chmod 600) on first use. */
export function hmacSecret(): string {
  const f = SECRET_PATHS.hmac;
  if (process.env.POT_HMAC_SECRET && !existsSync(/*turbopackIgnore: true*/ f)) return readSecret(f, (s) => s.length >= 32, "HMAC secret", "POT_HMAC_SECRET");
  if (process.env.VERCEL) throw new Error("POT_HMAC_SECRET is not configured.");
  if (!existsSync(/*turbopackIgnore: true*/ f)) {
    mkdirSync(/*turbopackIgnore: true*/ path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(/*turbopackIgnore: true*/ f, randomBytes(32).toString("base64url"), { mode: 0o600 });
    chmodSync(/*turbopackIgnore: true*/ f, 0o600);
  }
  return readSecret(f, (s) => s.length >= 32, "HMAC secret");
}

/** Secret Telegram sends in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
export function telegramWebhookSecret(): string | null {
  const v = process.env.POT_TELEGRAM_WEBHOOK_SECRET?.trim();
  if (v && /^[A-Za-z0-9_-]{32,256}$/.test(v)) return v;
  try {
    return readSecret(path.join(home, ".pot", "webhook_secret"), (s) => /^[A-Za-z0-9_-]{32,256}$/.test(s), "Webhook secret");
  } catch {
    return null;
  }
}

/** Gemini API key for AI market drafting (file ~/.pot/gemini_key or env POT_GEMINI_KEY). Null when not set up. */
export function geminiKey(): string | null {
  try {
    return readSecret(SECRET_PATHS.gemini, (s) => /^[A-Za-z0-9._-]{20,200}$/.test(s), "Gemini key", "POT_GEMINI_KEY");
  } catch {
    return null;
  }
}

/** POSIX: a secret file readable by group/others is refused. Windows has no POSIX modes (stat reports 0o666), so just warn once. */
let warnedWin = false;
export function checkPermissions(file: string, label: string, platform: string = process.platform) {
  if (platform === "win32") {
    if (!warnedWin) { warnedWin = true; console.warn(`[pot] Windows: can't check that ${label} file is private (chmod 600); keep it in your user profile.`); }
    return;
  }
  const mode = statSync(/*turbopackIgnore: true*/ file).mode & 0o777;
  if (mode & 0o077) throw new Error(`${label} file ${file} must be chmod 600.`);
}
