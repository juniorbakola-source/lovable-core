/**
 * Unit tests for src/lib/time-series.ts
 *
 * Coverage:
 *  - safeDivide        — zero denominator, normal cases
 *  - roundToMoq        — MOQ=0 (unconstrained), MOQ>0, exact multiples, zero qty
 *  - isSkuActive       — active/inactive detection
 *  - extractSkuFeatures — null/default values, safe clamping, MOQ=0 preserved
 *  - computeForecastMetrics — MOQ=0 default, safe ops, missing/inactive SKU,
 *                             unit/constraint coherence
 *  - buildForecastSeries   — produces 30 forecast points, no NaN/negative
 */

import { describe, it, expect } from "vitest";
import {
  safeDivide,
  roundToMoq,
  isSkuActive,
  extractSkuFeatures,
  computeForecastMetrics,
  buildForecastSeries,
} from "./time-series";
import type { SkuFeatures } from "./time-series";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid SkuRow-compatible object (all nullable fields set to null) */
function makeSkuRow(
  overrides: Partial<{
    id: string;
    sku_code: string | null;
    name: string | null;
    category: string | null;
    stock: number | null;
    on_order: number | null;
    in_production: number | null;
    lead_time_days: number | null;
    moq: number | null;
    unit_cost: number | null;
    service_level: number | null;
    demand_history: number[] | null;
    demand_history_yearly: number[] | null;
    forecast_3m: number[] | null;
    min_stock: number | null;
    max_stock: number | null;
    ai_min_recommended: number | null;
    ai_max_recommended: number | null;
    ai_justification: string | null;
    ai_optimized_at: string | null;
    company_id: string | null;
    user_id: string | null;
    created_at: string | null;
    updated_at: string | null;
  }> = {},
) {
  return {
    id: "test-id",
    sku_code: "TEST-001",
    name: "Test SKU",
    category: null,
    stock: 100,
    on_order: 0,
    in_production: 0,
    lead_time_days: 7,
    moq: 50,
    unit_cost: 10,
    service_level: 0.95,
    demand_history: [5, 6, 7, 5, 6, 8, 5, 7, 6, 5],
    demand_history_yearly: [150, 160, 170, 155, 145, 160, 175, 165, 150, 145, 155, 165],
    forecast_3m: [500, 520, 510],
    min_stock: null,
    max_stock: null,
    ai_min_recommended: null,
    ai_max_recommended: null,
    ai_justification: null,
    ai_optimized_at: null,
    company_id: null,
    user_id: "user-1",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

/** Minimal active SkuFeatures fixture */
function makeFeatures(overrides: Partial<SkuFeatures> = {}): SkuFeatures {
  return {
    id: "test-id",
    skuCode: "TEST-001",
    name: "Test SKU",
    category: null,
    isActive: true,
    moq: 50,
    leadTimeDays: 7,
    serviceLevel: 0.95,
    unitCost: 10,
    stock: 100,
    onOrder: 0,
    inProduction: 0,
    minStock: null,
    maxStock: null,
    aiMinRecommended: null,
    aiMaxRecommended: null,
    demandHistory: [5, 6, 7, 5, 6, 8, 5, 7, 6, 5],
    demandHistoryYearly: [150, 160, 170, 155, 145, 160, 175, 165, 150, 145, 155, 165],
    forecast3m: [500, 520, 510],
    ...overrides,
  };
}

// ── safeDivide ────────────────────────────────────────────────────────────────

describe("safeDivide", () => {
  it("returns 0 for zero denominator (default fallback)", () => {
    expect(safeDivide(10, 0)).toBe(0);
  });

  it("returns custom fallback for zero denominator", () => {
    expect(safeDivide(10, 0, -1)).toBe(-1);
  });

  it("performs normal division", () => {
    expect(safeDivide(10, 2)).toBe(5);
  });

  it("handles negative numerator", () => {
    expect(safeDivide(-10, 2)).toBe(-5);
  });

  it("returns fallback for Infinity denominator", () => {
    expect(safeDivide(10, Infinity)).toBe(0);
  });

  it("returns fallback for NaN denominator", () => {
    expect(safeDivide(10, NaN)).toBe(0);
  });
});

// ── roundToMoq ────────────────────────────────────────────────────────────────

describe("roundToMoq", () => {
  it("MOQ=0 (unconstrained): returns qty unchanged as integer", () => {
    expect(roundToMoq(15, 0)).toBe(15);
  });

  it("MOQ=0 with exact integer qty", () => {
    expect(roundToMoq(100, 0)).toBe(100);
  });

  it("rounds up to next multiple of MOQ", () => {
    expect(roundToMoq(15, 10)).toBe(20);
  });

  it("exact multiple of MOQ returns same value", () => {
    expect(roundToMoq(10, 10)).toBe(10);
  });

  it("MOQ=1 returns qty unchanged", () => {
    expect(roundToMoq(37, 1)).toBe(37);
  });

  it("qty=0 returns 0 regardless of MOQ", () => {
    expect(roundToMoq(0, 50)).toBe(0);
    expect(roundToMoq(0, 0)).toBe(0);
  });

  it("rounds large MOQ correctly", () => {
    expect(roundToMoq(1, 100)).toBe(100);
    expect(roundToMoq(101, 100)).toBe(200);
  });
});

// ── isSkuActive ───────────────────────────────────────────────────────────────

describe("isSkuActive", () => {
  it("active when stock > 0", () => {
    expect(
      isSkuActive({
        stock: 10,
        demandHistory: [],
        demandHistoryYearly: [],
        aiMinRecommended: null,
      }),
    ).toBe(true);
  });

  it("active when demand history contains non-zero values", () => {
    expect(
      isSkuActive({
        stock: 0,
        demandHistory: [0, 5, 0],
        demandHistoryYearly: [],
        aiMinRecommended: null,
      }),
    ).toBe(true);
  });

  it("active when yearly demand history contains non-zero values", () => {
    expect(
      isSkuActive({
        stock: 0,
        demandHistory: [],
        demandHistoryYearly: [100],
        aiMinRecommended: null,
      }),
    ).toBe(true);
  });

  it("active when AI recommendation exists", () => {
    expect(
      isSkuActive({ stock: 0, demandHistory: [], demandHistoryYearly: [], aiMinRecommended: 50 }),
    ).toBe(true);
  });

  it("inactive when all indicators are zero/empty/null", () => {
    expect(
      isSkuActive({
        stock: 0,
        demandHistory: [0, 0, 0],
        demandHistoryYearly: [0],
        aiMinRecommended: null,
      }),
    ).toBe(false);
  });
});

// ── extractSkuFeatures ────────────────────────────────────────────────────────

describe("extractSkuFeatures", () => {
  it("extracts all fields from a well-formed row", () => {
    const row = makeSkuRow();
    const f = extractSkuFeatures(row);

    expect(f.id).toBe("test-id");
    expect(f.skuCode).toBe("TEST-001");
    expect(f.name).toBe("Test SKU");
    expect(f.moq).toBe(50);
    expect(f.leadTimeDays).toBe(7);
    expect(f.serviceLevel).toBe(0.95);
    expect(f.stock).toBe(100);
    expect(f.isActive).toBe(true);
  });

  it("preserves MOQ=0 (unconstrained) without clamping to 1", () => {
    const row = makeSkuRow({ moq: 0 });
    const f = extractSkuFeatures(row);
    expect(f.moq).toBe(0);
  });

  it("applies safe defaults for fully null row", () => {
    const row = makeSkuRow({
      sku_code: null,
      name: null,
      stock: null,
      on_order: null,
      in_production: null,
      lead_time_days: null,
      moq: null,
      unit_cost: null,
      service_level: null,
      demand_history: null,
      demand_history_yearly: null,
      forecast_3m: null,
    });
    const f = extractSkuFeatures(row);

    expect(f.skuCode).toBe("");
    expect(f.name).toBe("");
    expect(f.stock).toBe(0);
    expect(f.onOrder).toBe(0);
    expect(f.inProduction).toBe(0);
    expect(f.leadTimeDays).toBe(7); // default
    expect(f.moq).toBe(0); // default 0 = unconstrained
    expect(f.unitCost).toBe(0);
    expect(f.serviceLevel).toBe(0.95);
    expect(f.demandHistory).toEqual([]);
    expect(f.demandHistoryYearly).toEqual([]);
    expect(f.forecast3m).toEqual([]);
    expect(f.isActive).toBe(false);
  });

  it("clamps negative stock to 0", () => {
    const row = makeSkuRow({ stock: -10 });
    const f = extractSkuFeatures(row);
    expect(f.stock).toBe(0);
  });

  it("clamps lead_time_days < 1 to 1", () => {
    const row = makeSkuRow({ lead_time_days: 0 });
    const f = extractSkuFeatures(row);
    expect(f.leadTimeDays).toBe(1);
  });

  it("clamps service_level out of range", () => {
    const rowHigh = makeSkuRow({ service_level: 1.5 });
    expect(extractSkuFeatures(rowHigh).serviceLevel).toBeCloseTo(0.999);

    const rowLow = makeSkuRow({ service_level: -0.1 });
    expect(extractSkuFeatures(rowLow).serviceLevel).toBeCloseTo(0.001);
  });

  it("strips negative values from demand arrays", () => {
    const row = makeSkuRow({ demand_history: [-5, 10, -3], demand_history_yearly: [-100, 200] });
    const f = extractSkuFeatures(row);
    expect(f.demandHistory).toEqual([0, 10, 0]);
    expect(f.demandHistoryYearly).toEqual([0, 200]);
  });

  it("SKU active when ai_min_recommended is set", () => {
    const row = makeSkuRow({
      stock: 0,
      demand_history: [],
      demand_history_yearly: [],
      ai_min_recommended: 25,
    });
    const f = extractSkuFeatures(row);
    expect(f.isActive).toBe(true);
  });
});

// ── computeForecastMetrics ────────────────────────────────────────────────────

describe("computeForecastMetrics", () => {
  it("returns finite numbers for a normal SKU", () => {
    const m = computeForecastMetrics(makeFeatures());

    expect(isFinite(m.avgDailyDemand)).toBe(true);
    expect(isFinite(m.forecast30d)).toBe(true);
    expect(isFinite(m.safetyStock)).toBe(true);
    expect(isFinite(m.reorderPoint)).toBe(true);
    expect(isFinite(m.daysOfCover)).toBe(true);
    expect(m.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("MOQ=0: forecast30d is not rounded to a MOQ multiple", () => {
    const f = makeFeatures({ moq: 0, demandHistory: [10, 10, 10, 10, 10] });
    const m = computeForecastMetrics(f);
    // 10 u/day × 30 = 300 — no rounding applied, so should equal 300
    // (demand might blend with yearly/forecast, so just verify moq=0 doesn't distort)
    expect(m.forecast30d).toBeGreaterThan(0);
    // With moq=0, forecast30d should equal the raw rounded value
    const raw = Math.round(m.avgDailyDemand * 30);
    expect(m.forecast30d).toBe(raw);
  });

  it("MOQ>0: forecast30d is rounded up to nearest MOQ", () => {
    // avgDailyDemand ~10/day, 30d raw = 300; moq=100 → 300 exact → 300
    const f = makeFeatures({
      moq: 100,
      demandHistory: [10, 10, 10, 10, 10],
      demandHistoryYearly: [],
      forecast3m: [],
    });
    const m = computeForecastMetrics(f);
    expect(m.forecast30d % 100).toBe(0);
    expect(m.forecast30d).toBeGreaterThan(0);
  });

  it("recommendedOrder is a multiple of MOQ when stock < ROP", () => {
    // Force stock below ROP
    const f = makeFeatures({ stock: 0, onOrder: 0, inProduction: 0, moq: 50 });
    const m = computeForecastMetrics(f);
    if (m.recommendedOrder > 0) {
      expect(m.recommendedOrder % 50).toBe(0);
    }
  });

  it("recommendedOrder is 0 when stock+pipeline >= ROP", () => {
    // Abundant stock well above ROP
    const f = makeFeatures({
      stock: 100000,
      onOrder: 0,
      inProduction: 0,
      demandHistory: [1, 1, 1, 1, 1],
      demandHistoryYearly: [],
      forecast3m: [],
    });
    const m = computeForecastMetrics(f);
    expect(m.recommendedOrder).toBe(0);
  });

  it("inactive SKU (all zeros) does not crash and returns safe values", () => {
    const f = makeFeatures({
      isActive: false,
      stock: 0,
      onOrder: 0,
      inProduction: 0,
      demandHistory: [],
      demandHistoryYearly: [],
      forecast3m: [],
    });
    const m = computeForecastMetrics(f);

    expect(isFinite(m.avgDailyDemand)).toBe(true);
    expect(m.avgDailyDemand).toBe(0);
    expect(m.daysOfCover).toBe(999); // no demand → ∞ fallback
    expect(m.skuActive).toBe(false);
    expect(m.forecast30d).toBe(0);
  });

  it("status critical when stock <= safetyStock", () => {
    const f = makeFeatures({ stock: 0 });
    const m = computeForecastMetrics(f);
    expect(m.status).toBe("critical");
  });

  it("status overstock for very high stock relative to demand", () => {
    const f = makeFeatures({
      stock: 100000,
      demandHistory: [1, 1, 1],
      demandHistoryYearly: [],
      forecast3m: [],
    });
    const m = computeForecastMetrics(f);
    expect(m.status).toBe("overstock");
  });

  it("constraintsMet false when stock < minStock", () => {
    const f = makeFeatures({ stock: 10, minStock: 50 });
    const m = computeForecastMetrics(f);
    expect(m.constraintsMet).toBe(false);
  });

  it("constraintsMet false when stock > maxStock", () => {
    const f = makeFeatures({ stock: 200, maxStock: 100 });
    const m = computeForecastMetrics(f);
    expect(m.constraintsMet).toBe(false);
  });

  it("no division by zero when lead_time_days is very large", () => {
    const f = makeFeatures({ leadTimeDays: 365 });
    expect(() => computeForecastMetrics(f)).not.toThrow();
  });

  it("computeMs is a non-negative integer", () => {
    const m = computeForecastMetrics(makeFeatures());
    expect(m.computeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(m.computeMs)).toBe(true);
  });
});

// ── buildForecastSeries ───────────────────────────────────────────────────────

describe("buildForecastSeries", () => {
  it("produces exactly 30 forecast points (fc != null)", () => {
    const pts = buildForecastSeries(makeFeatures());
    const fcPts = pts.filter((p) => p.fc != null);
    expect(fcPts.length).toBe(30);
  });

  it("produces historical points equal to demand_history length", () => {
    const f = makeFeatures({ demandHistory: [5, 6, 7, 8, 9] });
    const pts = buildForecastSeries(f);
    const histPts = pts.filter((p) => p.hist != null);
    expect(histPts.length).toBe(5);
  });

  it("no negative fc values", () => {
    const pts = buildForecastSeries(makeFeatures());
    for (const p of pts.filter((x) => x.fc != null)) {
      expect(p.fc!).toBeGreaterThanOrEqual(0);
    }
  });

  it("lo <= fc <= hi for all forecast points", () => {
    const pts = buildForecastSeries(makeFeatures());
    for (const p of pts.filter((x) => x.fc != null)) {
      expect(p.lo!).toBeLessThanOrEqual(p.fc!);
      expect(p.fc!).toBeLessThanOrEqual(p.hi!);
    }
  });

  it("no NaN in any point field", () => {
    const pts = buildForecastSeries(makeFeatures());
    for (const p of pts) {
      for (const [, v] of Object.entries(p)) {
        if (typeof v === "number") {
          expect(isNaN(v)).toBe(false);
        }
      }
    }
  });

  it("works with empty demand history (inactive SKU)", () => {
    const f = makeFeatures({
      demandHistory: [],
      demandHistoryYearly: [],
      forecast3m: [],
      isActive: false,
    });
    const pts = buildForecastSeries(f);
    expect(pts.length).toBe(30); // only forecast, no historical
    expect(pts.filter((p) => p.fc != null).length).toBe(30);
  });

  it("confidence interval widens over the 30-day horizon", () => {
    const pts = buildForecastSeries(makeFeatures());
    const fcPts = pts.filter((p) => p.fc != null && p.hi != null);
    const widths = fcPts.map((p) => p.hi! - p.lo!);
    // Width at day 30 should be >= width at day 1
    expect(widths[widths.length - 1]).toBeGreaterThanOrEqual(widths[0]);
  });

  it("all date labels are in MM-DD format", () => {
    const pts = buildForecastSeries(makeFeatures());
    const mmDdPattern = /^\d{2}-\d{2}$/;
    for (const p of pts) {
      expect(p.d).toMatch(mmDdPattern);
    }
  });
});
