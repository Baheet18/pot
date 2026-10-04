import { ACTIONS_CORS_HEADERS, ACTION_RULES } from "@pot/core";
/** Solana Actions discovery: maps our market pages to their Action API so wallets/X can unfurl Blinks. */
export const GET = () => Response.json({ rules: ACTION_RULES }, { headers: ACTIONS_CORS_HEADERS });
export const OPTIONS = () => new Response(null, { headers: ACTIONS_CORS_HEADERS });
