import "./env";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fmtWat, validateDraft } from "@pot/core";
import { _resetGeminiCooldown, ambiguousRelativeDay, draftWithAI, lookupFixtures, setFixtureFetcher, stripRelativeTime } from "../src";

const NIGHT = Math.floor(Date.parse("2026-10-10T00:42:00+01:00") / 1000); // when Baheet tried it
const SAT_1230 = Math.floor(Date.parse("2026-10-10T12:30:00+01:00") / 1000);
const KEY = "AQ.test-key-not-real-0000000000";

/** Mock ESPN: recorded Premier League days (trimmed from the real feed), plus optional extra events; counts requests. */
function mockEspn(extra: Record<string, any[]> = {}, opts: { empty?: boolean } = {}) {
  const urls: string[] = [];
  setFixtureFetcher((async (u: string) => {
    urls.push(u);
    const day = /dates=(\d{8})/.exec(u)![1];
    if (opts.empty || !u.includes("/soccer/")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
    const f = path.join(__dirname, "fixtures", `espn-soccer-${day}.json`);
    const events = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).events : [];
    return new Response(JSON.stringify({ events: [...events, ...(extra[day] ?? [])] }), { status: 200 });
  }) as any);
  return urls;
}
const ev = (id: string, iso: string, home: string, away: string) => ({ id, date: iso, season: { slug: "2026-27-english-premier-league" }, status: { type: { name: "STATUS_SCHEDULED" } },
  competitions: [{ competitors: [{ homeAway: "home", team: { displayName: home } }, { homeAway: "away", team: { displayName: away } }] }] });
afterEach(() => { setFixtureFetcher(null); _resetGeminiCooldown(); });

describe("real fixture lookup", () => {
  it("Baheet's case: 'tomorrow' at 00:42 WAT → Arsenal v Leeds is today, Sat 10 Oct 12:30 WAT, and the draft says so", async () => {
    mockEspn();
    for (const q of ["/new will Arsenal win against leeds tomorrow", "/new will Arsenal win against leeds tomorrow 12:30 pm"]) {
      const r = await draftWithAI(q, { now: NIGHT, key: null });
      expect(r.kind).toBe("draft");
      if (r.kind !== "draft") return;
      expect(r.draft.eventStartTime).toBe(SAT_1230);
      expect(r.draft.startTime).toBe(SAT_1230); // buying closes at the real kick-off
      expect(r.draft.question).toMatch(/Sat, 10 Oct 2026/);
      expect(r.draft.resolutionRule).toMatch(/12:30/);
      expect(r.draft.warnings[0]).toBe("📅 Arsenal v Leeds United is today, Sat 10 Oct, 12:30 WAT, per the fixture list (not tomorrow), so I used that.");
      expect(validateDraft(r.draft, NIGHT)).toEqual([]);
    }
  });
  it("the AI gets the fixture as authoritative; if it still writes another time, the real kick-off wins", async () => {
    mockEspn();
    const calls: any[] = [];
    const wrong = { status: "draft", timing: "event", eventStartsAt: "2026-10-11T12:30:00+01:00", eventStartKnown: true, question: "Will Arsenal beat Leeds United on Sunday 11 October 2026?", title: "Arsenal to beat Leeds?",
      resolutionRule: "Resolves YES if Arsenal beat Leeds United in the Premier League match that kicks off at 12:30 WAT on Sunday 11 October 2026, based on the score after regular time plus stoppage time. Resolves NO otherwise, or if the match is not completed by 23:59 WAT on 11 October 2026. The official Premier League result decides.",
      sourcesOfTruth: ["https://www.premierleague.com"], category: "sports", region: "Global", buyingClosesAt: "2026-10-11T12:30:00+01:00", endsAt: "2026-10-11T15:00:00+01:00", resolvesAt: "2026-10-11T16:00:00+01:00", marketType: "breaking", eventInProgress: false, dateConfidence: "high", flags: [] };
    const fetchImpl = (async (_u: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(wrong) }] } }] }), { status: 200 }); }) as any;
    const r = await draftWithAI("/new will Arsenal win against leeds tomorrow", { now: NIGHT, key: KEY, fetchImpl });
    expect(JSON.stringify(calls[0])).toContain("Official fixture (authoritative");
    expect(JSON.stringify(calls[0])).toContain("Sat, 10 Oct 2026, 12:30 WAT");
    if (r.kind !== "draft") throw new Error(r.kind);
    expect(r.draft.eventStartTime).toBe(SAT_1230);
    expect(r.draft.question).not.toMatch(/Sun|11 Oct/);
  });
  it("matches nicknames and short names (Man Utd vs Spurs)", async () => {
    mockEspn();
    const m = await lookupFixtures("Man Utd vs Spurs tonight", NIGHT);
    expect(m.map((x) => `${x.fixture.home} v ${x.fixture.away}`)).toEqual(["Manchester United v Tottenham Hotspur"]);
    expect(fmtWat(m[0].fixture.kickoff)).toBe("Sat, 10 Oct 2026, 17:30 WAT");
  });
  it("asks when several fixtures match", async () => {
    mockEspn({ "20261011": [ev("x1", "2026-10-11T19:00Z", "Arsenal", "Everton")] });
    const r = await draftWithAI("/new will Arsenal win the match?", { now: NIGHT, key: null });
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") { expect(r.question).toMatch(/more than one match/); expect(r.question).toMatch(/Arsenal v Leeds United: Sat, 10 Oct 2026, 12:30 WAT/); expect(r.question).toMatch(/Arsenal v Everton/); }
  });
  it("after midnight with no fixture data, it confirms the day instead of guessing", async () => {
    mockEspn({}, { empty: true });
    const r = await draftWithAI("/new will Remo beat Enyimba tomorrow", { now: NIGHT, key: null });
    expect(r).toMatchObject({ kind: "clarify" });
    if (r.kind === "clarify") expect(r.question).toMatch(/Do you mean today, Sat 10 Oct, or Sun 11 Oct\?/);
  });
  it("in the daytime, a fixture on a different day than the admin said is followed, and the draft says so", async () => {
    mockEspn();
    const FRI_3PM = Math.floor(Date.parse("2026-10-09T15:00:00+01:00") / 1000);
    const r = await draftWithAI("/new Arsenal vs Leeds today", { now: FRI_3PM, key: null });
    if (r.kind !== "draft") throw new Error(r.kind);
    expect(r.draft.eventStartTime).toBe(SAT_1230);
    expect(r.draft.warnings[0]).toMatch(/is tomorrow, Sat 10 Oct, 12:30 WAT, per the fixture list \(not today\)/);
    expect(ambiguousRelativeDay("tomorrow", FRI_3PM)).toBeNull();
    expect(ambiguousRelativeDay("tonight's game", NIGHT)).toBe("tonight");
  });
  it("caches lookups (one request per sport per day) and stays quiet for non-sports questions", async () => {
    const urls = mockEspn();
    await lookupFixtures("Arsenal vs Leeds", NIGHT);
    const n = urls.length;
    await lookupFixtures("Arsenal vs Leeds", NIGHT);
    expect(urls.length).toBe(n);
    expect(n).toBe(4); // today + tomorrow × soccer + NBA
    await lookupFixtures("Will Tinubu win the 2027 election?", NIGHT);
    expect(urls.length).toBe(n);
    expect(stripRelativeTime("will Arsenal win against leeds tomorrow 12:30 pm?")).toBe("will Arsenal win against leeds?");
  });
});
