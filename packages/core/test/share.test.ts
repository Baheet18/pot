import { describe, expect, it } from "vitest";
import { receiptShareText, receiptXShareUrl, telegramShareUrl } from "../src/share";

const base = { title: "Will Haaland score vs Arsenal?", outcome: "yes" as const, practice: false };

describe("receipt share helpers", () => {
  it("brags only when the sharer won", () => {
    expect(receiptShareText({ ...base, result: "won" })).toBe('I called it on Pot 🍯 "Will Haaland score vs Arsenal?" resolved YES. See the receipt:');
    expect(receiptShareText({ ...base, result: "lost" })).toMatch(/^Settled on Pot 🍯/);
    expect(receiptShareText(base)).toMatch(/^Settled on Pot 🍯/);
  });
  it("labels practice markets and clips long titles", () => {
    const t = receiptShareText({ ...base, outcome: "no", practice: true, title: "word ".repeat(60).trim() });
    expect(t).toContain("resolved NO");
    expect(t).toContain("(practice market)");
    expect(t).toContain("…");
    expect(t.length).toBeLessThan(200);
  });
  it("builds an X intent with text and url encoded", () => {
    const u = new URL(receiptXShareUrl({ ...base, result: "won" }, "https://pot-navy.vercel.app/m/abc?ref=w"));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toMatch(/^I called it on Pot/);
    expect(u.searchParams.get("url")).toBe("https://pot-navy.vercel.app/m/abc?ref=w");
  });
  it("builds a Telegram share URL", () => {
    const u = new URL(telegramShareUrl("https://pot-navy.vercel.app/m/abc", "hi & bye"));
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe("https://pot-navy.vercel.app/m/abc");
    expect(u.searchParams.get("text")).toBe("hi & bye");
  });
});
