// Inventory optimization formulas
// Demand forecast = simple moving average
// Safety stock = z * sigma * sqrt(leadTime)
// Reorder point (ROP) = avg_daily_demand * leadTime + safetyStock
// Recommended order qty = max(target_cover_demand - projected_inventory, MOQ)

const Z_SCORES: Record<string, number> = {
  "0.9": 1.28,
  "0.95": 1.65,
  "0.975": 1.96,
  "0.99": 2.33,
};

export function zScore(serviceLevel: number): number {
  const key = serviceLevel.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return Z_SCORES[key] ?? 1.65;
}

export interface SkuInput {
  stock: number;
  on_order: number;
  lead_time_days: number;
  moq: number;
  unit_cost: number;
  service_level: number;
  demand_history: number[];
}

export interface OptimizationResult {
  avgDailyDemand: number;
  stdDev: number;
  safetyStock: number;
  reorderPoint: number;
  projectedInventory: number;
  recommendedOrder: number;
  daysOfCover: number;
  status: "critical" | "low" | "ok" | "overstock";
  inventoryValue: number;
}

export function optimize(s: SkuInput): OptimizationResult {
  const history = s.demand_history.length ? s.demand_history : [0];
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  const variance =
    history.length > 1
      ? history.reduce((acc, v) => acc + (v - avg) ** 2, 0) / (history.length - 1)
      : Math.max(avg, 1);
  const sigma = Math.sqrt(variance);
  const z = zScore(s.service_level);
  const safetyStock = z * sigma * Math.sqrt(s.lead_time_days);
  const reorderPoint = avg * s.lead_time_days + safetyStock;
  const projectedInventory = s.stock + s.on_order - avg * s.lead_time_days;
  const targetCover = avg * 30; // 30-day target
  const recommendedOrder = Math.max(
    Math.ceil(Math.max(targetCover - projectedInventory + safetyStock, 0)),
    projectedInventory < reorderPoint ? s.moq : 0,
  );
  const daysOfCover = avg > 0 ? (s.stock + s.on_order) / avg : Infinity;

  let status: OptimizationResult["status"] = "ok";
  if (s.stock <= safetyStock) status = "critical";
  else if (s.stock < reorderPoint) status = "low";
  else if (daysOfCover > 90) status = "overstock";

  return {
    avgDailyDemand: avg,
    stdDev: sigma,
    safetyStock: Math.ceil(safetyStock),
    reorderPoint: Math.ceil(reorderPoint),
    projectedInventory: Math.round(projectedInventory),
    recommendedOrder,
    daysOfCover: isFinite(daysOfCover) ? Math.round(daysOfCover) : 999,
    status,
    inventoryValue: s.stock * s.unit_cost,
  };
}
