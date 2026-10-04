import path from "node:path";

/** Non-secret runtime settings (env with safe defaults). */
export const MODE: "live" | "test" = process.env.PANTA_MODE === "live" ? "live" : "test";
export const SANDBOX = MODE === "test";
/** Live-key writes (quote/build/create/claim) are blocked unless explicitly enabled. */
export const LIVE_WRITES = MODE === "live" && process.env.POT_ALLOW_LIVE_WRITES === "1";
export const PANTA_BASE = process.env.PANTA_API_BASE_URL || "https://live-api.panta.market/api/v1";
/** Public base URL of the web app (used in Telegram buttons and Blinks). */
export const WEB_URL = (
  process.env.POT_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3100")
).replace(/\/$/, "");
export const RPC_URL = process.env.SOLANA_RPC_URL || (SANDBOX ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
export const CLUSTER: "mainnet" | "devnet" = SANDBOX ? "devnet" : "mainnet";
/** Hosted Postgres (Neon via Vercel Marketplace). When unset, a local SQLite file is used. */
export const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const DB_PATH = process.env.POT_DB_PATH || path.join(process.env.POT_ROOT || process.cwd().replace(/\/apps\/(web|bot)$/, ""), "data", "pot.db");
/** Catalog image used when we can't upload one (must be public https). */
export const DEFAULT_MARKET_IMAGE =
  process.env.POT_DEFAULT_IMAGE_URL || "https://res.cloudinary.com/demo/image/upload/sample.jpg";
