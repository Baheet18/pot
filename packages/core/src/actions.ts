/**
 * Solana Actions (Blinks) payload builders. Spec: https://solana.com/docs/advanced/actions
 * Pure: the route handlers fetch data / build transactions and pass the results in.
 */
export const ACTIONS_VERSION = "2.4";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export const ACTIONS_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "Content-Type": "application/json",
};

export function actionHeaders(chainId: string) {
  return { ...ACTIONS_CORS_HEADERS, "X-Action-Version": ACTIONS_VERSION, "X-Blockchain-Ids": chainId };
}

export interface ActionLink {
  type: "transaction" | "post" | "external-link";
  label: string;
  href: string;
  parameters?: Array<{ name: string; label: string; type?: string; required?: boolean; min?: number; max?: number }>;
}

export interface ActionGetResponse {
  type: "action" | "completed";
  icon: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  error?: { message: string };
  links?: { actions: ActionLink[] };
}

export const BLINK_AMOUNTS = [2, 5, 10] as const;
export const BLINK_MIN_USDC = 1;
export const BLINK_MAX_USDC = 500;

export function marketActionGet(opts: {
  marketId: string;
  title: string;
  icon: string;
  verdictLine: string;
  yesPct: number | null;
  paysYes: number | null;
  paysNo: number | null;
  buyable: boolean;
  ref: string;
  rs?: string | null;
  sandbox: boolean;
}): ActionGetResponse {
  const q = (side: "yes" | "no", amount?: number | string) =>
    `/api/actions/m/${opts.marketId}?side=${side}&amount=${amount ?? "{amount}"}&ref=${encodeURIComponent(opts.ref)}${opts.rs ? `&rs=${encodeURIComponent(opts.rs)}` : ""}`;
  const pay = (x: number | null) => (x === null ? "—" : `$${x.toFixed(2)}`);
  const desc = [
    opts.sandbox ? "🧪 Sandbox test (no real money)." : null,
    opts.verdictLine,
    opts.yesPct !== null ? `Money split: ${Math.round(opts.yesPct * 100)}% YES.` : null,
    opts.paysYes !== null || opts.paysNo !== null ? `Pays about ${pay(opts.paysYes)}/share if YES is right, ${pay(opts.paysNo)} if NO (estimate).` : null,
    "Powered by Panta.",
  ]
    .filter(Boolean)
    .join(" ");
  if (!opts.buyable) {
    return { type: "action", icon: opts.icon, title: opts.title, description: desc, label: "Buying closed", disabled: true, error: { message: "This market is no longer in its buy-only phase." } };
  }
  const actions: ActionLink[] = [
    ...BLINK_AMOUNTS.map((a) => ({ type: "transaction" as const, label: `YES $${a}`, href: q("yes", a) })),
    ...BLINK_AMOUNTS.map((a) => ({ type: "transaction" as const, label: `NO $${a}`, href: q("no", a) })),
    {
      type: "transaction",
      label: "Buy YES",
      href: q("yes"),
      parameters: [{ name: "amount", label: "USDC amount", type: "number", required: true, min: BLINK_MIN_USDC, max: BLINK_MAX_USDC }],
    },
  ];
  return { type: "action", icon: opts.icon, title: opts.title, description: desc, label: "Buy", links: { actions } };
}

export function parseAmount(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < BLINK_MIN_USDC || n > BLINK_MAX_USDC) return null;
  return Math.round(n * 100) / 100;
}

export function completedAction(icon: string, title: string, description: string): ActionGetResponse {
  return { type: "completed", icon, title, description, label: "Done" };
}

/** dial.to renders any Action URL as a Blink page (also what X unfurls via registered hosts). */
export function blinkUrl(actionUrl: string, cluster: "mainnet" | "devnet" = "mainnet") {
  return `https://dial.to/?action=${encodeURIComponent("solana-action:" + actionUrl)}${cluster === "devnet" ? "&cluster=devnet" : ""}`;
}
