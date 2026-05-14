import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  calculateDynamicInventory,
  toInventorySku,
  weeklyRecalculation,
} from "./dynamic-inventory";
import type { Database } from "../integrations/supabase/types";

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

function makeSkuRow(overrides: Partial<SkuRow> = {}): SkuRow {
  return {
    ai_justification: null,
    ai_max_recommended: null,
    ai_min_recommended: null,
    ai_optimized_at: null,
    category: null,
    company_id: null,
    created_at: "2025-01-01T00:00:00.000Z",
    demand_history: [80, 90, 100, 120, 110, 95, 105, 115, 130, 125, 118, 122],
    demand_history_yearly: [1200],
    forecast_3m: [140, 135, 145],
    id: "sku-1",
    in_production: 20,
    lead_time_days: 10,
    max_stock: null,
    min_stock: null,
    moq: 10,
    name: "SKU 1",
    on_order: 30,
    service_level: 0.95,
    sku_code: "SKU-1",
    stock: 50,
    unit_cost: 10,
    updated_at: null,
    user_id: "user-1",
    ...overrides,
  };
}

describe("dynamic inventory engine", () => {
  it("maps Supabase SKU rows safely", () => {
    const row = makeSkuRow({ sku_code: null, name: "Fallback Name" });
    const sku = toInventorySku(row);
    expect(sku.skuCode).toBe("Fallback Name");
    expect(sku.stock).toBe(50);
    expect(sku.onOrder).toBe(30);
    expect(sku.inProduction).toBe(20);
  });

  it("calculates dynamic inventory metrics", () => {
    const sku = toInventorySku(makeSkuRow());
    const result = calculateDynamicInventory(sku, DEFAULT_CONFIG);

    expect(result.annualDemand).toBeGreaterThan(0);
    expect(result.coverageTargetDays).toBeGreaterThan(0);
    expect(result.reorderPoint).toBeGreaterThanOrEqual(0);
    expect(result.maxQuantity).toBeGreaterThanOrEqual(result.reorderPoint);
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it("supports weekly recalculation for multiple SKUs", () => {
    const skus = [
      toInventorySku(makeSkuRow({ id: "sku-1", sku_code: "SKU-1" })),
      toInventorySku(makeSkuRow({ id: "sku-2", sku_code: "SKU-2", stock: 0, on_order: 0 })),
    ];
    const results = weeklyRecalculation(skus, DEFAULT_CONFIG);
    expect(results).toHaveLength(2);
    expect(results[0].skuCode).toBe("SKU-1");
    expect(results[1].skuCode).toBe("SKU-2");
  });
});
