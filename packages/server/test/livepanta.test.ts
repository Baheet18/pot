import "./env";
import { afterEach, describe, expect, it } from "vitest";
import { getLivePanta, listLivePanta, setLiveFetcher, toLiveMarket, LIVE_WRITES, SANDBOX } from "../src";

const NOW = 1791800000;
export const LIVE_ITEMS = [
  { marketId: "CLQqZ7r6WYC5xNumWrmC7UAkQ1Z6pdCbjJSy7wQu1DgL", title: "Will BTC reach a new all-time high by December 31, 2026?", phase: "primary", status: "primary", resolved: false, yesPrice: "0.501663897", noPrice: "0.498336103", totalVolumeUsdc: "6.00", startTime: NOW + 7200, endTime: NOW + 9e6, marketType: "breaking", category: "crypto" },
  { marketId: "9ArgG5SQf9T6QbVWEjNwpBpNkdPjNWNTNB15nkdivv15", title: "Will Arsenal beat Leeds United on October 10, 2026?", phase: "secondary", status: "secondary", resolved: false, yesPrice: "0.51684771", secondaryYesPrice: "0.6", secondaryNoPrice: "0.45", totalVolumeUsdc: "323.036406", startTime: NOW - 9000, endTime: NOW + 3600, marketType: "breaking", category: "sports" },
  { marketId: "EtrjihLvFjmztdXwSxhwiKe4fWvVPspMC4TUeede7GLg", title: "", phase: "secondary", status: "secondary", resolved: false, totalVolumeUsdc: "10", startTime: NOW - 10, endTime: NOW + 10 },
  { marketId: "HLPNPsoRDk36jGF1FqtBENmEq3NRFgMe1wpSos2QyQBq", title: "Done one", phase: "resolved", status: "resolved", resolved: true, startTime: 1, endTime: 2 },
];
export function mockLive(items: unknown[] | number = LIVE_ITEMS) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  setLiveFetcher((async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (typeof items === "number") return new Response("{}", { status: items });
    return new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 });
  }) as any);
  return calls;
}
afterEach(() => setLiveFetcher(null));

describe("read-only live Panta data (practice mode)", () => {
  it("lists only open markets with titles: buy-phase first, then order-book ones by pot", async () => {
    const calls = mockLive();
    const l = await listLivePanta(6, NOW);
    expect(l.map((m) => m.title)).toEqual(["Will BTC reach a new all-time high by December 31, 2026?", "Will Arsenal beat Leeds United on October 10, 2026?"]);
    expect(l[0]).toMatchObject({ phase: "primary", yesPrice: 0.501663897, potUsdc: 6, buyingClosesAt: NOW + 7200, url: "https://www.panta.market/market/CLQqZ7r6WYC5xNumWrmC7UAkQ1Z6pdCbjJSy7wQu1DgL" });
    expect(l[1]).toMatchObject({ phase: "secondary", yesPrice: 0.6, noPrice: 0.45 }); // order-book prices once buying has closed
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as any)["X-Api-Key"]).toMatch(/^pk_live_/);
    await listLivePanta(6, NOW);
    expect(calls).toHaveLength(1); // cached
  });
  it("stays practice-only: still test mode, live writes still off", () => {
    expect(SANDBOX).toBe(true);
    expect(LIVE_WRITES).toBe(false);
  });
  it("handles errors and bad ids quietly", async () => {
    const calls = mockLive(500);
    expect(await listLivePanta(6, NOW)).toEqual([]);
    expect(await getLivePanta("not-an-id", NOW)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(toLiveMarket({ marketId: "x", title: "t", phase: "primary", startTime: NOW - 1, endTime: NOW + 10 }, NOW)).toBeNull(); // buying already over
  });
});
