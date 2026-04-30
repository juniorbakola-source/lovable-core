export function safetyStock(z: number, sigma: number, leadTime: number): number {
  return z * sigma * Math.sqrt(leadTime);
}

export function reorderPoint(avgDemand: number, leadTime: number, safetyStock: number): number {
  return (avgDemand * leadTime) + safetyStock;
}

export function eoq(demand: number, orderingCost: number, holdingCost: number): number {
  return Math.sqrt((2 * demand * orderingCost) / holdingCost);
}

export function availableStock(onHand: number, reserved: number): number {
  return onHand - reserved;
}

export function projectedStock(available: number, onOrder: number, inProduction: number): number {
  return available + onOrder + inProduction;
}

export function stockCoverageDays(projected: number, avgDailyDemand: number): number {
  if (avgDailyDemand === 0) return Infinity;
  return projected / avgDailyDemand;
}
