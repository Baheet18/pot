import { describe, expect, it, vi } from "vitest";

// A plain function (not vi.fn): vi.fn tracks settled results and would report the rejected lookup as unhandled.
let lookup: (id: string) => Promise<unknown> = async () => null;
vi.mock("@pot/server", () => ({ getMarketView: (id: string) => lookup(id) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/ClaimPanel", () => ({ ClaimPanel: () => null }));
vi.mock("@/lib/ui", () => ({ LIVE_WRITES: false, RPC_URL: "", SANDBOX: true, sp: (v: unknown) => (Array.isArray(v) ? v[0] : v) }));

import ClaimPage from "../src/app/claim/[id]/page";

const call = (id: string, q: Record<string, string> = {}) => ClaimPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(q) });

describe("/claim/[id]", () => {
  it("404s for a market id that doesn't exist", async () => {
    lookup = async () => null;
    await expect(call("abc")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when the market lookup fails", async () => {
    lookup = async () => { throw new Error("lookup failed"); };
    await expect(call("abc", { kind: "creator" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the claim form, titled with the market, for a real market", async () => {
    lookup = async () => ({ market: { title: "Will it rain?" }, royalty: { estimatedUsdc: 1, royaltyBps: 200, note: "" } });
    const el = await call("real");
    expect(JSON.stringify(el)).toContain("Will it rain?");
    expect(JSON.stringify(el)).toContain("Claim winnings");
  });
});
