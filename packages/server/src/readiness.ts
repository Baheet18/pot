/**
 * Go-live readiness: which settings a live deploy needs. Reports booleans and names only, never values.
 * Pure over an env object so it is unit-tested and usable before flipping anything.
 */
export interface ReadinessCheck { name: string; ok: boolean; detail: string }
export function liveReadiness(env: Record<string, string | undefined>): { mode: string; liveWrites: boolean; ready: boolean; checks: ReadinessCheck[] } {
  const mode = env.PANTA_MODE === "live" ? "live" : "test";
  const has = (k: string) => !!(env[k] && env[k]!.trim());
  const httpsHost = (k: string, bad: RegExp) => { try { const u = new URL(env[k] ?? ""); return u.protocol === "https:" && !bad.test(u.host); } catch { return false; } };
  const checks: ReadinessCheck[] = [
    { name: "PANTA_MODE=live", ok: mode === "live", detail: "the switch; anything else means practice" },
    { name: "POT_ALLOW_LIVE_WRITES=1", ok: env.POT_ALLOW_LIVE_WRITES === "1", detail: "without it every live quote/build/create/claim is refused" },
    { name: "POT_PANTA_LIVE_KEY set", ok: has("POT_PANTA_LIVE_KEY") && /^pk_live_/.test(env.POT_PANTA_LIVE_KEY!), detail: "server-only, encrypted Vercel env var" },
    { name: "SOLANA_RPC_URL (mainnet, private)", ok: httpsHost("SOLANA_RPC_URL", /devnet|testnet|api\.mainnet-beta\.solana\.com/), detail: "the public RPC rate-limits; use Helius/Triton/QuickNode mainnet" },
    { name: "Market image (POT_DEFAULT_IMAGE_URL or https POT_PUBLIC_URL)", ok: httpsHost("POT_DEFAULT_IMAGE_URL", /res\.cloudinary\.com$/) || (!has("POT_DEFAULT_IMAGE_URL") && (httpsHost("POT_PUBLIC_URL", /^$/) || has("VERCEL_PROJECT_PRODUCTION_URL"))), detail: "live default is <site>/market-default.png; Panta's catalog shows it" },
    { name: "DATABASE_URL", ok: has("DATABASE_URL") || has("POSTGRES_URL"), detail: "Neon Postgres (rows are mode-scoped)" },
    { name: "CRON_SECRET", ok: has("CRON_SECRET"), detail: "protects the settlement cron" },
    { name: "POT_TELEGRAM_TOKEN", ok: has("POT_TELEGRAM_TOKEN"), detail: "bot webhook" },
    { name: "POT_HMAC_SECRET", ok: has("POT_HMAC_SECRET"), detail: "signs share refs and create links" },
  ];
  return { mode, liveWrites: mode === "live" && env.POT_ALLOW_LIVE_WRITES === "1", ready: checks.every((c) => c.ok), checks };
}
