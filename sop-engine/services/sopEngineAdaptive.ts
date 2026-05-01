import { safetyStock, reorderPoint, eoq, availableStock, projectedStock } from "./calculations";

export function computeSOPAdaptive(data: any) {
  const has12M = data.consumption12m && data.consumption12m > 0;
  const has3M = data.consumption3m && data.consumption3m > 0;

  let avgDemand = 0;
  let sigma = 0;
  let z = data.z || 1.65;
  let lifecycle = "MATURE";

  if (has12M && has3M) {
    avgDemand = (0.6 * data.consumption3m + 0.4 * data.consumption12m) / 30;
    sigma = data.variability || (data.max - data.min) / 4;
  } else if (has3M) {
    avgDemand = (data.consumption3m / 90) * 1.2;
    sigma = avgDemand * 0.5;
    z = 2.05;
    lifecycle = "NEW";
  } else {
    avgDemand = data.initialForecast || 1;
    sigma = avgDemand * 0.5;
    z = 2.05;
    lifecycle = "NEW";
  }

  const ss = safetyStock(z, sigma, data.leadTime);
  const rop = reorderPoint(avgDemand, data.leadTime, ss);

  const available = availableStock(data.onHand, data.reserved);
  const projected = projectedStock(available, data.onOrder, data.inProduction);

  const annualDemand = avgDemand * 365;
  const eoqQty = eoq(annualDemand, data.orderingCost || 50, data.holdingCost || 5);

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
    lifecycle,
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
