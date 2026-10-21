import { describe, expect, it } from "vitest";
import { CREATE_GRID, MARKET_GRID } from "../src/lib/layout";

// Regression: on a 390px phone the market page laid out at 635px and scrolled sideways, because the grid's
// implicit auto column grew to the content's min width. Every track must be minmax(0,1fr) on phones and desktop.
describe.each([["MARKET_GRID", MARKET_GRID, "380px"], ["CREATE_GRID", CREATE_GRID, "340px"]])("%s", (_n, cls, side) => {
  const classes = cls.split(/\s+/);
  it("has an explicit shrinkable single column on phones", () => {
    expect(classes).toContain("grid-cols-[minmax(0,1fr)]");
  });
  it("keeps the main column shrinkable next to the side panel on desktop", () => {
    expect(classes).toContain(`md:grid-cols-[minmax(0,1fr)_${side}]`);
    expect(classes.some((c) => /grid-cols-\[1fr/.test(c))).toBe(false);
  });
});
