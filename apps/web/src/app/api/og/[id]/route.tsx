import { ImageResponse } from "next/og";
import { fmtTime, fmtUsd } from "@pot/core";
import { getMarketView, type MarketView } from "@pot/server";

/** Open Graph / X card image (1200×630) and square Blink icon (?sq=1, 800×800) for a market. No emoji (no network fonts). */
const HEADERS = { "cache-control": "public, max-age=120, s-maxage=120, stale-while-revalidate=600" };

type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const sq = new URL(req.url).searchParams.get("sq") === "1";
  const v = await getMarketView(id).catch(() => null);
  const size = sq ? { width: 800, height: 800 } : { width: 1200, height: 630 };
  return new ImageResponse(v ? <MarketImage v={v} sq={sq} /> : <Fallback />, { ...size, headers: HEADERS });
}

function Fallback() {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", background: "#0c0a09", color: "#fafaf9", padding: 72 }}>
      <div style={{ display: "flex", fontSize: 72, fontWeight: 900, color: "#fbbf24" }}>Pot</div>
      <div style={{ display: "flex", fontSize: 40, marginTop: 16 }}>Group prediction markets on Panta</div>
    </div>
  );
}

function MarketImage({ v, sq }: { v: MarketView; sq: boolean }) {
  const m = v.market;
  const ys = v.stats.yesSplit;
  const y = ys === null ? 50 : Math.round(ys * 100);
  const people = v.stats.realWallets;
  const title = m.title.length > 110 ? m.title.slice(0, 107).replace(/\s+\S*$/, "") + "…" : m.title;
  const closes = m.primaryPhaseEndTime ?? m.startTime;
  const pad = sq ? 56 : 64;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "linear-gradient(160deg, #1c1917 0%, #0c0a09 60%)", color: "#fafaf9", padding: pad, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 900, color: "#fbbf24" }}>Pot</div>
          {v.practice || v.sandbox ? <div style={{ display: "flex", marginLeft: 20, padding: "6px 16px", borderRadius: 999, border: "2px solid #38bdf8", color: "#bae6fd", fontSize: 22, fontWeight: 700 }}>PRACTICE MARKET · NO REAL MONEY</div> : null}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#a8a29e", textTransform: "uppercase" }}>{m.category}</div>
      </div>
      <div style={{ display: "flex", marginTop: sq ? 44 : 36, fontSize: sq ? 52 : 54, fontWeight: 900, lineHeight: 1.15 }}>{title}</div>
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex", alignItems: "center", marginBottom: 22 }}>
        {m.isResolved ? <div style={{ display: "flex", padding: "6px 18px", borderRadius: 12, background: "#fbbf24", color: "#0c0a09", fontSize: 30, fontWeight: 900, marginRight: 20 }}>{`RESULT: ${m.yesWins ? "YES" : "NO"}`}</div> : null}
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#e7e5e4" }}>{`${m.isResolved ? "Final pot" : "Pot"} ${fmtUsd(m.totalVolumeUsdc)} · ${people} ${people === 1 ? "person" : "people"}`}</div>
      </div>
      <div style={{ display: "flex", width: "100%", height: 30, borderRadius: 999, overflow: "hidden", background: "#292524" }}>
        <div style={{ display: "flex", width: `${y}%`, background: "#34d399" }} />
        <div style={{ display: "flex", width: `${100 - y}%`, background: "#fb7185" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 30, fontWeight: 800 }}>
        <div style={{ display: "flex", color: "#34d399" }}>{ys === null ? "YES —" : `YES ${y}%`}</div>
        <div style={{ display: "flex", color: "#fb7185" }}>{ys === null ? "NO —" : `NO ${100 - y}%`}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontSize: 22, color: "#a8a29e" }}>
        <div style={{ display: "flex" }}>{m.isResolved ? "Settled" : v.buyable ? `Buying closes ${fmtTime(closes)}` : "Buying closed"}</div>
        <div style={{ display: "flex" }}>Powered by Panta</div>
      </div>
    </div>
  );
}
