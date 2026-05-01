import { safetyStock, reorderPoint, eoq, availableStock, projectedStock } from "./calculations";

export function computeSOP(data: any) {
  const avgDemand = (0.6 * data.consumption3m + 0.4 * data.consumption12m) / 30;

  const sigma = data.variability || (data.max - data.min) / 4;

  const ss = safetyStock(data.z || 1.65, sigma, data.leadTime);
  const rop = reorderPoint(avgDemand, data.leadTime, ss);

  const available = availableStock(data.onHand, data.reserved);
  const projected = projectedStock(available, data.onOrder, data.inProduction);

  const eoqQty = eoq(data.annualDemand || avgDemand * 365, data.orderingCost || 50, data.holdingCost || 5);

  const min = rop;
  const max = rop + (avgDemand * data.reviewPeriod);

  let recommendation = {
    action: "HOLD",
    quantity: 0
  };

  if (projected < min) {
    recommendation = {
      action: "ORDER",
      quantity: Math.max(max - projected, eoqQty)
    };
  }

  return {
    avgDemand,
    sigma,
    safetyStock: ss,
    rop,
    min,
    max,
    projected,
    recommendation
  };
}
