import { describe, expect, it } from "vitest";
import { draftMarket, validateDraft, toCreateQuoteBody, LIMITS } from "../src/draft";

const NOW = Math.floor(Date.parse("2026-10-03T17:30:00+01:00") / 1000); // Sat 3 Oct 2026, 17:30 WAT

describe("draftMarket", () => {
  it("drafts a football match market with WAT kick-off and official sources", () => {
    const d = draftMarket("/new Will Nigeria beat Benin on Friday 5pm?", { now: NOW });
    expect(d.kind).toBe("match");
    expect(d.question).toBe("Will Nigeria beat Benin on Fri, 9 Oct 2026?");
    expect(d.startTime).toBe(Math.floor(Date.parse("2026-10-09T17:00:00+01:00") / 1000));
    expect(d.endTime - d.startTime).toBe(2.5 * 3600);
    expect(d.resolutionTime - d.endTime).toBe(3600);
    expect(d.resolutionRule).toMatch(/regular time plus stoppage time/);
    expect(d.resolutionRule).toMatch(/penalty shootouts do not count/);
    expect(d.resolutionRule).toMatch(/postponed/);
    expect(d.sourcesOfTruth[0]).toBe("https://thenff.com");
    expect(d.region).toBe("Nigeria");
    expect(d.category).toBe("sports");
    // 5.9 days away → standard ($50)
    expect(d.marketType).toBe("standard");
    expect(d.creationFeeUsdc).toBe(50);
    expect(validateDraft(d, NOW)).toEqual([]);
  });

  it("uses a breaking market ($20) when the event is within 72h", () => {
    const d = draftMarket("Arsenal beat Chelsea | tomorrow 4:30pm", { now: NOW });
    expect(d.marketType).toBe("breaking");
    expect(d.creationFeeUsdc).toBe(20);
    expect(d.sourcesOfTruth).toContain("https://www.premierleague.com");
    expect(d.warnings).toEqual([]);
    expect(validateDraft(d, NOW)).toEqual([]);
  });

  it("drafts a crypto price market that closes buying an hour before the reading", () => {
    const d = draftMarket("BTC above $70k tomorrow 9pm", { now: NOW });
    expect(d.kind).toBe("price");
    expect(d.question).toBe("Will Bitcoin (BTC) be at or above $70,000 at Sun, 4 Oct 2026, 21:00 WAT?");
    expect(d.endTime - d.startTime).toBe(3600);
    expect(d.sourcesOfTruth[0]).toBe("https://www.coingecko.com");
    expect(d.category).toBe("crypto");
  });

  it("does not read 'Season 11' as a date", () => {
    const d = draftMarket("Will a female housemate win BBNaija Season 11 on Sunday 10pm", { now: NOW });
    expect(d.kind).toBe("reality");
    expect(d.question).toContain("Season 11");
    expect(d.startTime).toBe(Math.floor(Date.parse("2026-10-04T22:00:00+01:00") / 1000));
    expect(d.resolutionRule).toMatch(/Fan polls and leaks do not count/);
  });

  it("warns when no time is given and assumes a default", () => {
    const d = draftMarket("Will Osimhen score against Benin on 9 October", { now: NOW });
    expect(d.kind).toBe("scorer");
    expect(d.warnings.join(" ")).toMatch(/assumed 20:00 WAT/);
  });

  it("falls back to a generic rule and says so", () => {
    const d = draftMarket("Will Tinubu sign the new tax bill | 31 Dec 2026", { now: NOW });
    expect(d.kind).toBe("generic");
    expect(d.warnings.join(" ")).toMatch(/couldn't match a template/);
    expect(d.resolutionRule).toMatch(/23:59 WAT/);
  });

  it("marks an event starting within the hour as breaking + in progress", () => {
    const d = draftMarket("Will France beat Belgium in 30 minutes", { now: NOW });
    expect(d.marketType).toBe("breaking");
    expect(d.eventInProgress).toBe(true);
    expect(validateDraft(d, NOW)).toEqual([]);
  });

  it("rejects events in the past and empty input", () => {
    const d = draftMarket("Will Arsenal beat Chelsea | 1 Oct 2026 5pm", { now: NOW });
    expect(validateDraft(d, NOW).join()).toMatch(/past/);
    expect(() => draftMarket("/new   ", { now: NOW })).toThrow();
  });

  it("builds a create-quote body within Panta limits", () => {
    const d = draftMarket("Nigeria beat Benin | Fri 5pm", { now: NOW });
    const body = toCreateQuoteBody(d, "Wallet111", "https://img.example/x.png");
    expect(body.question.length).toBeLessThanOrEqual(LIMITS.question);
    expect(body.resolutionRule.length).toBeLessThanOrEqual(LIMITS.rule);
    expect(body).not.toHaveProperty("eventInProgress");
    expect(body.imageUrl).toBe("https://img.example/x.png");
  });
});
