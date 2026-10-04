import "./env";
import { beforeEach, describe, expect, it } from "vitest";
import { draftMarket, validateDraft } from "@pot/core";
import { _resetGeminiCooldown, applyEdit, draftWithAI, isPersonalBet, multiOutcome, toMarketDraft } from "../src";

beforeEach(() => _resetGeminiCooldown());
const NOW = Math.floor(Date.parse("2026-10-04T15:32:00+01:00") / 1000);
const KEY = "AQ.test-key-not-real-0000000000";
function mockGemini(...outs: object[]) {
  const calls: unknown[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const o = outs[Math.min(calls.length - 1, outs.length - 1)];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const RULE = "Resolves YES if Arsenal win the Premier League match against Chelsea at the Emirates Stadium that kicks off at 17:30 WAT on Saturday 10 October 2026, based on the score after regular time plus stoppage time. Extra time and penalties do not count. Resolves NO if Arsenal draw or lose, or if the match is abandoned, postponed or not completed by 23:59 WAT on 10 October 2026. The official Premier League result decides; if sources disagree, the first listed source wins. Fan reports do not count.";
const MATCH = {
  status: "draft", timing: "event", eventStartsAt: "2026-10-10T17:30:00+01:00", eventStartKnown: true,
  question: "Will Arsenal beat Chelsea on Saturday 10 October 2026?", title: "Arsenal to beat Chelsea?", resolutionRule: RULE,
  sourcesOfTruth: ["https://www.premierleague.com", "https://www.bbc.com/sport/football"], category: "sports", region: "Global",
  // The model left a default close 24h before the end: must be snapped to kick-off.
  buyingClosesAt: "2026-10-09T23:59:00+01:00", endsAt: "2026-10-10T23:59:00+01:00", resolvesAt: "2026-10-11T12:00:00+01:00",
  marketType: "standard", eventInProgress: false, dateConfidence: "high", flags: [],
};
const KICKOFF = Math.floor(Date.parse("2026-10-10T17:30:00+01:00") / 1000);

describe("drafting fix (a): buying closes at kick-off", () => {
  it("snaps the AI's close time to the event start and validates it server-side", async () => {
    const g = mockGemini(MATCH);
    const r = await draftWithAI("/new Arsenal vs Chelsea Saturday 5:30pm", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind).toBe("draft");
    if (r.kind !== "draft") return;
    expect(r.draft.timing).toBe("event");
    expect(r.draft.eventStartTime).toBe(KICKOFF);
    expect(r.draft.startTime).toBe(KICKOFF);
    expect(r.draft.warnings.join(" ")).toMatch(/Buying closes at kick-off/);
    expect(validateDraft(r.draft, NOW)).toEqual([]);
    // Moving the close past kick-off is rejected; /edit kickoff moves both.
    const late = applyEdit(r.draft, "closes", "2026-10-10 18:30", NOW);
    expect(validateDraft(late, NOW).join(" ")).toMatch(/buying must close at kick-off/);
    const moved = applyEdit(r.draft, "kickoff", "2026-10-11 16:00", NOW);
    expect(moved.startTime).toBe(moved.eventStartTime);
    expect(moved.endTime).toBeGreaterThan(moved.startTime);
    expect(validateDraft(moved, NOW)).toEqual([]);
  });

  it("asks for the start time when the AI doesn't know it", async () => {
    const g = mockGemini({ ...MATCH, eventStartKnown: false, clarifyingQuestion: "What time does Arsenal vs Chelsea kick off (WAT)?" });
    const r = await draftWithAI("/new Arsenal vs Chelsea", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r).toEqual({ kind: "clarify", question: "What time does Arsenal vs Chelsea kick off (WAT)?" });
  });

  it("the basic drafter also asks instead of assuming a time; with a time it closes at kick-off", async () => {
    const r1 = await draftWithAI("/new Will Arsenal beat Chelsea", { now: NOW, key: null });
    expect(r1.kind).toBe("clarify");
    const r2 = await draftWithAI("/new Arsenal vs Chelsea", { now: NOW, key: null });
    expect(r2.kind).toBe("clarify");
    if (r2.kind === "clarify") expect(r2.question).toMatch(/kick-off/);
    const r3 = await draftWithAI("/new Will Arsenal beat Chelsea on Saturday 5:30pm?", { now: NOW, key: null });
    expect(r3.kind).toBe("draft");
    if (r3.kind === "draft") { expect(r3.draft.startTime).toBe(KICKOFF); expect(r3.draft.eventStartTime).toBe(KICKOFF); }
  });

  it("validateDraft: an event draft without a start, or closing after it, can't be created", () => {
    const d = draftMarket("Will Arsenal beat Chelsea on Saturday 5:30pm?", { now: NOW });
    expect(validateDraft(d, NOW)).toEqual([]);
    expect(validateDraft({ ...d, eventStartTime: undefined }, NOW).join(" ")).toMatch(/start time \(kick-off\) is unknown/);
    expect(validateDraft({ ...d, startTime: KICKOFF + 600 }, NOW).join(" ")).toMatch(/buying must close at kick-off/);
    // Deadline-style markets are unaffected.
    const t = toMarketDraft({ ...MATCH, timing: "deadline", buyingClosesAt: "2026-10-09T23:59:00+01:00" } as never, NOW).draft!;
    expect(t.startTime).toBe(Math.floor(Date.parse("2026-10-09T23:59:00+01:00") / 1000));
  });
});

describe("drafting fix (b): personal bets are politely refused", () => {
  it.each(["will Tolu pay me back", "will my crush text me", "Will I pass my exam on Friday?", "will our landlord fix the gate"])("%s", async (t) => {
    const g = mockGemini(MATCH);
    const r = await draftWithAI(`/new ${t}`, { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind).toBe("refuse");
    if (r.kind === "refuse") { expect(r.message).toMatch(/no fair way to settle/); expect(r.suggestion).toMatch(/\/new Will/); }
    expect(g.calls).toHaveLength(0); // no AI call needed
  });
  it("public questions are not refused", () => {
    for (const t of ["Will Davido marry Chioma before 2027?", "Will Inter beat Milan on Sunday?", "Will Nigeria beat Ghana?"]) expect(isPersonalBet(t)).toBe(false);
  });
  it("the AI can refuse the ones the rules miss", async () => {
    const g = mockGemini({ status: "refuse", refuseReason: "That's between you and Ada, and no public source will report it.", suggestion: "/new Will Burna Boy win a Grammy in 2027?" });
    const r = await draftWithAI("/new will Ada come to the party", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r).toEqual({ kind: "refuse", message: "😅 That's between you and Ada, and no public source will report it.", suggestion: "Something that would work: /new Will Burna Boy win a Grammy in 2027?" });
  });
});

describe("drafting fix (c): multi-outcome questions", () => {
  it("named options become YES/NO questions without calling the AI", async () => {
    const g = mockGemini(MATCH);
    const r = await draftWithAI("/new which club will win the Premier League: Arsenal, Man City or Liverpool?", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(g.calls).toHaveLength(0);
    expect(r).toEqual({ kind: "multi", question: "which club will win the Premier League: Arsenal, Man City or Liverpool?", rephrase: null, options: [
      { label: "Arsenal", question: "Will Arsenal win the Premier League?" },
      { label: "Man City", question: "Will Man City win the Premier League?" },
      { label: "Liverpool", question: "Will Liverpool win the Premier League?" },
    ] });
  });
  it("the AI names the top contenders and a one-question rephrase", async () => {
    const g = mockGemini({ status: "multi", options: [{ label: "Kellyrae", question: "Will Kellyrae win BBNaija Season 10?" }, { label: "Wanni", question: "Will Wanni win BBNaija Season 10?" }], rephrase: "Will a female housemate win BBNaija Season 10?" });
    const r = await draftWithAI("/new who wins BBNaija?", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind).toBe("multi");
    if (r.kind === "multi") { expect(r.options.map((o) => o.label)).toEqual(["Kellyrae", "Wanni"]); expect(r.rephrase).toMatch(/female housemate/); }
  });
  it("without the AI, it asks for the contenders instead of guessing", async () => {
    const r = await draftWithAI("/new who will win the 2027 election?", { now: NOW, key: null });
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") expect(r.question).toMatch(/YES\/NO only.*Name A, Name B or Name C/s);
  });
  it("detects common shapes", () => {
    expect(multiOutcome("who wins BBNaija?")?.contest).toBe("BBNaija");
    expect(multiOutcome("Who will be the next Arsenal manager?")?.verb).toBe("be");
    expect(multiOutcome("who wins BBNaija between Kellyrae, Wanni and Shaun")?.options).toEqual(["Kellyrae", "Wanni", "Shaun"]);
    expect(multiOutcome("Will Arsenal win the league?")).toBeNull();
  });
});
