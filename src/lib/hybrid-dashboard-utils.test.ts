import { describe, expect, it } from "vitest";
import { escapeCsvCell, getVolatilityBand } from "./hybrid-dashboard-utils";

describe("getVolatilityBand", () => {
  it("classifies low volatility", () => {
    expect(getVolatilityBand(0)).toBe("low");
    expect(getVolatilityBand(0.2)).toBe("low");
  });

  it("classifies medium volatility", () => {
    expect(getVolatilityBand(0.21)).toBe("medium");
    expect(getVolatilityBand(0.35)).toBe("medium");
  });

  it("classifies high volatility", () => {
    expect(getVolatilityBand(0.36)).toBe("high");
  });

  it("handles non-finite or negative values safely", () => {
    expect(getVolatilityBand(-1)).toBe("low");
    expect(getVolatilityBand(Infinity)).toBe("low");
    expect(getVolatilityBand(-Infinity)).toBe("low");
  });
});

describe("escapeCsvCell", () => {
  it("wraps values in quotes", () => {
    expect(escapeCsvCell("ABC")).toBe('"ABC"');
  });

  it("escapes double quotes", () => {
    expect(escapeCsvCell('A "quoted" value')).toBe('"A ""quoted"" value"');
  });

  it("normalizes CRLF and strips null bytes", () => {
    expect(escapeCsvCell("line1\r\nline2\u0000")).toBe('"line1\nline2"');
  });

  it("normalizes standalone carriage returns and repeated null bytes", () => {
    expect(escapeCsvCell("line1\rline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("text\u0000\u0000more")).toBe('"textmore"');
  });
});
