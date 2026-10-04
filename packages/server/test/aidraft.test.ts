import "./env";
import { describe, expect, it } from "vitest";
import { validateDraft } from "@pot/core";
import { beforeEach } from "vitest";
import { _resetGeminiCooldown, applyEdit, draftWithAI, GEMINI_MODELS, systemPrompt, toMarketDraft } from "../src";

beforeEach(() => _resetGeminiCooldown());

const NOW = Math.floor(Date.parse("2026-10-04T15:32:00+01:00") / 1000); // when Baheet sent the PSG test
const KEY = "AQ.test-key-not-real-0000000000";

type Call = { url: string; headers: Record<string, string>; body: any };
function mockGemini(...outs: Array<object | number>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const o = outs[Math.min(calls.length - 1, outs.length - 1)];
    if (typeof o === "number") return new Response("{}", { status: o });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const PSG = {
  status: "draft",
  question: "Will Paris Saint-Germain win the 2026–27 UEFA Champions League?",
  title: "PSG to win the 2026–27 Champions League?",
  resolutionRule: "Resolves YES if Paris Saint-Germain are officially confirmed by UEFA as winners of the 2026–27 UEFA Champions League final (extra time and penalties count). Resolves NO if any other club wins, PSG are eliminated, or no winner is confirmed by 23:59 WAT on 30 June 2027. A postponed final still counts if it is played by that deadline. Fan reports and leaks do not count; UEFA's official result decides.",
  sourcesOfTruth: ["https://www.uefa.com", "https://www.bbc.com/sport/football", "javascript:alert(1)"],
  category: "sports", region: "Global",
  buyingClosesAt: "2027-05-29T20:00:00+01:00", endsAt: "2027-05-29T23:30:00+01:00", resolvesAt: "2027-05-30T12:00:00+01:00",
  marketType: "breaking", eventInProgress: false, dateConfidence: "medium",
  flags: [{ type: "date_uncertain", note: "UEFA hasn't confirmed the 2027 final date; check it." }],
};
const TRUMP = {
  status: "draft",
  question: "Will Donald Trump leave office as US President before January 1, 2027?",
  title: "Trump out as US President before 2027?",
  resolutionRule: "Resolves YES if Donald Trump ceases to be President of the United States before 00:00 WAT on 1 January 2027 for any reason: resignation, death, removal after Senate conviction, or the Vice President becoming President under the 25th Amendment. A temporary transfer of power (Acting President) does not count. Announcements of intent do not count. Otherwise NO.",
  sourcesOfTruth: ["https://apnews.com", "https://www.reuters.com", "https://www.whitehouse.gov"],
  category: "politics", region: "Global",
  buyingClosesAt: "2026-12-31T22:59:00+01:00", endsAt: "2026-12-31T23:59:00+01:00", resolvesAt: "2027-01-01T12:00:00+01:00",
  marketType: "standard", eventInProgress: false, dateConfidence: "high", flags: [],
};

describe("AI drafter (mocked Gemini)", () => {
  it("PSG 'this season' becomes a long-dated standard market after the 2027 final, not a 24h breaking one", async () => {
    const g = mockGemini(PSG);
    const r = await draftWithAI("/new will PSG win the champions league this season", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind).toBe("draft");
    if (r.kind !== "draft") return;
    const d = r.draft;
    expect(d.drafter).toBe("ai");
    expect(d.question).toBe("Will Paris Saint-Germain win the 2026–27 UEFA Champions League?");
    expect(d.marketType).toBe("standard"); // corrected from the model's "breaking"
    expect(d.creationFeeUsdc).toBe(50);
    expect(d.endTime).toBeGreaterThan(Math.floor(Date.parse("2027-05-01T00:00:00Z") / 1000));
    expect(d.sourcesOfTruth).toEqual(["https://www.uefa.com", "https://www.bbc.com/sport/football"]); // non-https dropped
    expect(d.warnings.join(" ")).toMatch(/standard market \(\$50 fee\)/);
    expect(d.warnings.join(" ")).toMatch(/Check the date/);
    expect(validateDraft(d, NOW)).toEqual([]);
    // Request shape: key only in the header, structured JSON, low temperature, today's date in WAT.
    const c = g.calls[0];
    expect(c.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`);
    expect(c.url).not.toContain(KEY);
    expect(c.headers["x-goog-api-key"]).toBe(KEY);
    expect(c.body.generationConfig.responseMimeType).toBe("application/json");
    expect(c.body.generationConfig.responseSchema.properties.buyingClosesAt).toBeTruthy();
    expect(c.body.generationConfig.temperature).toBeLessThanOrEqual(0.3);
    expect(c.body.systemInstruction.parts[0].text).toContain("Sunday, 4 October 2026 at 15:32 WAT");
    expect(c.body.contents[0].parts[0].text).toContain("will PSG win the champions league this season");
  });

  it("Trump before 2027: keeps the clean question and the 31 Dec 2026 deadline", async () => {
    const g = mockGemini(TRUMP);
    const r = await draftWithAI("/new Trump out as President before 2027?", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    if (r.kind !== "draft") throw new Error("expected draft");
    expect(r.draft.question).toBe("Will Donald Trump leave office as US President before January 1, 2027?");
    expect(r.draft.endTime).toBe(Math.floor(Date.parse("2026-12-31T23:59:00+01:00") / 1000));
    expect(r.draft.marketType).toBe("standard");
    expect(r.draft.resolutionRule).toMatch(/25th Amendment/);
    expect(validateDraft(r.draft, NOW)).toEqual([]);
  });

  it("asks for a fuller rule when the model's rule is too thin", async () => {
    const g = mockGemini({ ...TRUMP, resolutionRule: "Resolves YES if he leaves office." }, TRUMP);
    const r = await draftWithAI("Trump out before 2027", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind === "draft" && r.draft.drafter).toBe("ai");
    expect(JSON.stringify(g.calls[1].body.contents)).toMatch(/too thin/);
  });

  it("asks a clarifying question when the idea is too vague", async () => {
    const g = mockGemini({ status: "clarify", clarifyingQuestion: "Which match do you mean, and what should YES mean?" });
    const r = await draftWithAI("/new football tomorrow", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r).toEqual({ kind: "clarify", question: "Which match do you mean, and what should YES mean?" });
  });

  it("repairs a bad draft once (past dates), then succeeds", async () => {
    const g = mockGemini({ ...TRUMP, buyingClosesAt: "2025-01-01T00:00:00+01:00", endsAt: "2025-01-02T00:00:00+01:00" }, TRUMP);
    const r = await draftWithAI("Trump out before 2027", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind).toBe("draft");
    expect(g.calls).toHaveLength(2);
    expect(JSON.stringify(g.calls[1].body.contents)).toMatch(/problems/);
  });

  it("falls back to the rule-based drafter, clearly labelled, when Gemini errors or stays invalid", async () => {
    const err = await draftWithAI("Trump out as President before 2027", { now: NOW, key: KEY, fetchImpl: mockGemini(500).fetchImpl });
    if (err.kind !== "draft") throw new Error("expected draft");
    expect(err.draft.drafter).toBe("rules");
    expect(err.draft.warnings[0]).toMatch(/AI drafter unavailable \(HTTP 500\)/);
    const bad = await draftWithAI("Trump out as President before 2027", { now: NOW, key: KEY, fetchImpl: mockGemini({ ...TRUMP, sourcesOfTruth: ["http://x.com"] }).fetchImpl });
    if (bad.kind !== "draft") throw new Error("expected draft");
    expect(bad.draft.warnings[0]).toMatch(/failed validation/);
    const none = await draftWithAI("Trump out as President before 2027", { now: NOW, key: null });
    if (none.kind !== "draft") throw new Error("expected draft");
    expect(none.draft.warnings[0]).toMatch(/no AI key/);
  });

  it("skips a model that is over its daily quota (429) and uses the next", async () => {
    const g = mockGemini(429, TRUMP);
    const r = await draftWithAI("Trump out before 2027", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind === "draft" && r.draft.drafter).toBe("ai");
    const g2 = mockGemini(TRUMP);
    await draftWithAI("Trump out before 2027", { now: NOW, key: KEY, fetchImpl: g2.fetchImpl });
    expect(g2.calls[0].url).toContain(GEMINI_MODELS[1]); // first model still cooling down
  });

  it("tries the next model when the first one is unavailable", async () => {
    const g = mockGemini(404, TRUMP);
    const r = await draftWithAI("Trump out before 2027", { now: NOW, key: KEY, fetchImpl: g.fetchImpl });
    expect(r.kind === "draft" && r.draft.drafter).toBe("ai");
    expect(g.calls[1].url).toContain(GEMINI_MODELS[1]);
  });

  it("turns disallowed / already-decided flags into blockers", () => {
    const { draft } = toMarketDraft({ ...TRUMP, flags: [{ type: "disallowed", note: "About someone's death." }, { type: "one_sided", note: "Most will pick NO." }] }, NOW);
    expect(draft!.blockers).toEqual(["Not allowed on Panta: About someone's death."]);
    expect(draft!.warnings.join(" ")).toMatch(/Looks one-sided/);
    expect(validateDraft(draft!, NOW).join(" ")).toMatch(/Not allowed/);
  });

  it("rejects buying that closes in under an hour unless it's a breaking in-progress event", () => {
    const soon = toMarketDraft({ ...TRUMP, buyingClosesAt: new Date((NOW + 600) * 1000).toISOString(), endsAt: new Date((NOW + 7200) * 1000).toISOString() }, NOW);
    expect(soon.draft!.eventInProgress).toBe(true);
    expect(soon.draft!.marketType).toBe("breaking");
    const order = toMarketDraft({ ...TRUMP, buyingClosesAt: "2027-01-02T00:00:00+01:00" }, NOW);
    expect(order.problems.join()).toMatch(/before endsAt/);
  });

  it("the prompt carries the market-writing guidance", () => {
    const p = systemPrompt(NOW);
    for (const re of [/this season/, /25th Amendment/, /Postponements/, /Official vs reported/, /breaking" only if/, /disallowed/, /CLARIFY/, /only YES or NO/]) expect(p).toMatch(re);
  });
});

describe("/edit fields", () => {
  const base = toMarketDraft(TRUMP, NOW).draft!;
  it("changing times recomputes type and fee", () => {
    const d = applyEdit(base, "closes", "2026-10-06 18:00", NOW);
    expect(d.marketType).toBe("breaking");
    expect(d.creationFeeUsdc).toBe(20);
    const e = applyEdit(base, "ends", "2027-01-15 12:00", NOW);
    expect(e.endTime).toBe(Math.floor(Date.parse("2027-01-15T12:00:00+01:00") / 1000));
    expect(e.resolutionTime).toBeGreaterThan(e.endTime);
  });
  it("validates sources, categories and field names", () => {
    expect(applyEdit(base, "sources", "https://apnews.com, https://www.bbc.com/news", NOW).sourcesOfTruth).toEqual(["https://apnews.com", "https://www.bbc.com/news"]);
    expect(() => applyEdit(base, "sources", "http://insecure.example", NOW)).toThrow(/https/);
    expect(() => applyEdit(base, "category", "gossip", NOW)).toThrow(/Category/);
    expect(() => applyEdit(base, "colour", "red", NOW)).toThrow(/I can edit/);
    expect(applyEdit(base, "question", "Will Donald Trump resign before 2027", NOW).question).toBe("Will Donald Trump resign before 2027?");
  });
});
