import { describe, expect, it } from "vitest";
import { draftMarket, validateDraft, sourcesFor, normaliseClause } from "../src/draft";
import { findDeadline } from "../src/deadline";

// Sun 4 Oct 2026, 15:09 WAT: when Baheet sent the real test.
const NOW = Math.floor(Date.parse("2026-10-04T15:09:00+01:00") / 1000);
const wat = (iso: string) => Math.floor(Date.parse(`${iso}+01:00`) / 1000);

describe("findDeadline", () => {
  const cases: Array<[string, string, string]> = [
    ["Trump out as President before 2027?", "before January 1, 2027", "2026-12-31T23:59:00"],
    ["BTC above 100k by Dec 31", "by December 31, 2026", "2026-12-31T23:59:00"],
    ["Tinubu signs the bill by end of year", "by December 31, 2026", "2026-12-31T23:59:00"],
    ["Naira at 1000 by end of month", "by October 31, 2026", "2026-10-31T23:59:00"],
    ["Wizkid drops an album this weekend", "by October 4, 2026", "2026-10-04T23:59:00"],
    ["Rain in Lagos tonight", "by October 4, 2026", "2026-10-04T23:59:00"],
    ["Davido releases a song in October", "by October 31, 2026", "2026-10-31T23:59:00"],
    ["GTA 6 out by November", "by November 30, 2026", "2026-11-30T23:59:00"],
    ["Obi joins ADC before Oct 20", "before October 20, 2026", "2026-10-19T23:59:00"],
    ["Pope visits Lagos on 20 October", "by October 20, 2026", "2026-10-20T23:59:00"],
    ["BTC hits 150k by Oct 20 6pm", "by 18:00 WAT on October 20, 2026", "2026-10-20T18:00:00"],
    ["Starmer resigns in 2027", "by December 31, 2027", "2027-12-31T23:59:00"],
    ["Something happens within 3 days", "by October 7, 2026", "2026-10-07T23:59:00"],
    ["Jan 5 deal signed", "by January 5, 2027", "2027-01-05T23:59:00"], // already passed this year → next year
  ];
  it.each(cases)("%s", (text, phrase, iso) => {
    const d = findDeadline(text, NOW)!;
    expect(d.phrase).toBe(phrase);
    expect(d.unix).toBe(wat(iso));
  });
  it("returns null when there is no deadline", () => {
    expect(findDeadline("Will Arsenal beat Chelsea", NOW)).toBeNull();
    expect(findDeadline("Will a female housemate win BBNaija Season 11", NOW)).toBeNull();
  });
});

describe("Baheet's real test: /new Trump out as President before 2027?", () => {
  const d = draftMarket("/new Trump out as President before 2027?", { now: NOW });
  it("writes a clean question with the deadline once, not a 24h default", () => {
    expect(d.question).toBe("Will Donald Trump leave office as US President before January 1, 2027?");
    expect(d.question).not.toMatch(/ by /);
    expect(d.endTime).toBe(wat("2026-12-31T23:59:00"));
    expect(d.warnings.join(" ")).not.toMatch(/24 hours/);
  });
  it("is a long-dated standard ($50) politics market", () => {
    expect(d.kind).toBe("office");
    expect(d.category).toBe("politics");
    expect(d.marketType).toBe("standard");
    expect(d.creationFeeUsdc).toBe(50);
    expect(d.eventInProgress).toBe(false);
    expect(validateDraft(d, NOW)).toEqual([]);
  });
  it("has a specific rule with the edge cases spelled out", () => {
    const r = d.resolutionRule;
    for (const re of [/resignation/, /death/, /impeachment AND conviction/, /25th Amendment/, /Acting President .* does not count/, /House alone does not count/, /23:59 WAT on Thu, 31 Dec 2026/, /announcement.*does not count/])
      expect(r).toMatch(re);
    expect(r.length).toBeLessThanOrEqual(2048);
  });
  it("uses US politics sources", () => {
    expect(d.sourcesOfTruth).toEqual(["https://apnews.com", "https://www.reuters.com", "https://www.whitehouse.gov"]);
  });
  it("also works with the deadline after a pipe", () => {
    const p = draftMarket("/new Trump out as President | before 2027", { now: NOW });
    expect(p.question).toBe(d.question);
    expect(p.endTime).toBe(d.endTime);
  });
});

describe("stronger templates", () => {
  it("Nigerian president: constitution sections and acting-president edge case", () => {
    const d = draftMarket("Will Tinubu resign before 2027", { now: NOW });
    expect(d.question).toBe("Will Bola Tinubu leave office as President of Nigeria before January 1, 2027?");
    expect(d.resolutionRule).toMatch(/Section 143/);
    expect(d.resolutionRule).toMatch(/acting as President .* does not count/);
    expect(d.sourcesOfTruth[0]).toBe("https://www.premiumtimesng.com");
    expect(d.region).toBe("Nigeria");
  });
  it("prime minister: caretaker does not count", () => {
    const d = draftMarket("Starmer out as PM by end of year", { now: NOW });
    expect(d.question).toBe("Will Keir Starmer leave office as UK Prime Minister by December 31, 2026?");
    expect(d.resolutionRule).toMatch(/caretaker/);
    expect(d.sourcesOfTruth[0]).toBe("https://www.bbc.co.uk/news");
  });
  it("elections name the official authority", () => {
    const d = draftMarket("Peter Obi wins the 2027 election", { now: NOW });
    expect(d.kind).toBe("election");
    expect(d.question).toBe("Will Peter Obi win the 2027 Nigerian presidential election?");
    expect(d.resolutionRule).toMatch(/INEC/);
    expect(d.sourcesOfTruth[0]).toBe("https://www.inecnigeria.org");
    expect(d.marketType).toBe("standard");
  });
  it("crypto 'hit by <date>' is a touch market on Coinbase, not a 24h reading", () => {
    const d = draftMarket("BTC hit 150k by Dec 31", { now: NOW });
    expect(d.question).toBe("Will Bitcoin (BTC) reach $150,000 by December 31, 2026?");
    expect(d.resolutionRule).toMatch(/at any time .* Coinbase/);
    expect(d.endTime).toBe(wat("2026-12-31T23:59:00"));
    expect(d.marketType).toBe("standard");
  });
  it("generic: grammatical question, deadline once, topic sources, breaking when soon", () => {
    const d = draftMarket("Wizkid drops an album this weekend", { now: NOW });
    expect(d.question).toBe("Will Wizkid drop an album by October 4, 2026?");
    expect(d.marketType).toBe("breaking");
    expect(d.region).toBe("Nigeria");
    expect(d.sourcesOfTruth[0]).toBe("https://www.pulse.ng");
    const g = draftMarket("Obi joins ADC before Oct 20", { now: NOW });
    expect(g.question).toBe("Will Obi join ADC before October 20, 2026?");
    expect(g.resolutionRule).toMatch(/rumours or leaks .* do not count/);
  });
  it("only defaults to 24h when there is truly no date", () => {
    const d = draftMarket("Will Davido sign with a new label", { now: NOW });
    expect(d.warnings.join(" ")).toMatch(/No date or deadline found/);
    expect(d.question).toMatch(/^Will Davido sign with a new label by /);
  });
  it("normalises chat shorthand", () => {
    expect(normaliseClause("Arsenal to beat Chelsea?")).toBe("Arsenal beat Chelsea");
    expect(normaliseClause("Will Obi joins ADC")).toBe("Obi join ADC");
    expect(normaliseClause("Trump will resign")).toBe("Trump resign");
  });
  it("matches sources to topic", () => {
    expect(sourcesFor("BTC price", "crypto")[0]).toBe("https://www.coinbase.com/price");
    expect(sourcesFor("Arsenal vs Chelsea", "sports")).toContain("https://www.espn.com/soccer/");
  });
});
