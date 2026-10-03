import "server-only";
import { FlowError, PantaError } from "@pot/server";

/** Small JSON helpers. Errors never include secrets: Panta errors are reduced to code + message. */
export function errorResponse(e: unknown, headers: Record<string, string> = {}) {
  if (e instanceof FlowError) return Response.json({ code: e.code, message: e.message }, { status: e.status, headers });
  if (e instanceof PantaError) return Response.json({ code: e.code, message: e.message }, { status: e.status >= 500 ? 502 : e.status, headers });
  console.error("[pot] unexpected", (e as Error)?.message);
  return Response.json({ code: "INTERNAL", message: "Something went wrong" }, { status: 500, headers });
}
export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  const t = await req.text();
  if (t.length > 20_000) throw new FlowError(413, "TOO_BIG", "Request too large");
  try { return JSON.parse(t || "{}") as T; } catch { throw new FlowError(400, "BAD_JSON", "Bad JSON"); }
}
export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
