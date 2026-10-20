import { describe, expect, it } from "vitest";
import { amountProblem, parseAmount, toNumber } from "../src";

describe("toNumber", () => {
  it("treats blank and whitespace strings as NaN, not 0", () => {
    expect(toNumber("")).toBeNaN();
    expect(toNumber("   ")).toBeNaN();
    expect(toNumber("\t\n")).toBeNaN();
  });
  it("rejects non-numeric types", () => {
    for (const v of [null, undefined, {}, [], true]) expect(toNumber(v)).toBeNaN();
    expect(toNumber("abc")).toBeNaN();
  });
  it("parses numbers and numeric strings", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("5")).toBe(5);
    expect(toNumber(" 12.5 ")).toBe(12.5);
  });
});

describe("amountProblem", () => {
  it.each(["", "  ", null, undefined, "abc", 0, "0", -5, "-5", 0.5, 500.01, 9999, Infinity, NaN])("rejects %s", (v) => {
    expect(amountProblem(v)?.code).toBe("BAD_AMOUNT");
  });
  it("gives a clear message for blank input", () => {
    expect(amountProblem("")?.message).toMatch(/Enter an amount between \$1 and \$500/);
  });
  it.each([1, "1", 5, "25.50", 500])("accepts %s", (v) => expect(amountProblem(v)).toBeNull());
});

describe("parseAmount (Blinks)", () => {
  it.each([null, "", " ", "0", "-1", "501", "abc"])("returns null for %s", (v) => expect(parseAmount(v)).toBeNull());
  it("rounds valid amounts to cents", () => {
    expect(parseAmount("5")).toBe(5);
    expect(parseAmount("10.567")).toBe(10.57);
    expect(parseAmount(" 20 ")).toBe(20);
  });
});
