import "server-only";
export { SANDBOX, LIVE_WRITES, RPC_URL, CLUSTER, WEB_URL, MODE } from "@pot/server";
export const sp = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
