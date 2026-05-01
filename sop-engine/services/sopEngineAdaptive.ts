import { safetyStock, reorderPoint, eoq, availableStock, projectedStock } from "./calculations";

export type Lifecycle = "NEW" | "MATURE" | "OBSOLETE";

export interface SOPAdaptiveResult {
  lifecycle: Lifecycle;
  avgDemand: number;
  sigma: number;
  z: number;
  safetyStock: number;
  rop: number;
  min: number;
  max: number;
  projected: number;
  recommendation: {
    action: "ORDER" | "HOLD" | "REVIEW";
    quantity: number;
    reason: string;
  };
}

export function computeSOPAdaptive(data: any): SOPAdaptiveResult {
  const has12M = data.consumption12m && data.consumption12m > 0;
  const has3M = data.consumption3m && data.consumption3m > 0;

  let avgDemand = 0;
  let sigma = 0;
  let z = data.z || 1.65;
  let lifecycle: Lifecycle = "MATURE";

  if (has12M && has3M) {
    const daily12M = data.consumption12m / 365;
    const daily3M = data.consumption3m / 90;
    // Detect OBSOLETE: 3-month daily demand is significantly lower than 12-month trend
    const declineRatio = daily12M > 0 ? daily3M / daily12M : 1;
    if (declineRatio < 0.3) {
      // Demand dropped >70% compared to yearly average — product is declining fast
      lifecycle = "OBSOLETE";
      avgDemand = daily3M;
      sigma = data.variability || avgDemand * 0.6;
      z = 1.28; // lower service level for OBSOLETE: reduce overstock risk
    } else {
      lifecycle = "MATURE";
      avgDemand = (0.6 * data.consumption3m + 0.4 * data.consumption12m) / 30;
      const rangeEstimate =
        data.max != null && data.min != null && data.max !== data.min
          ? (data.max - data.min) / 4
          : null;
      sigma = data.variability || rangeEstimate || avgDemand * 0.3;
    }
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

  const reviewPeriod = data.reviewPeriod || 7;
  const min = rop;
  const max = rop + avgDemand * reviewPeriod;

  let recommendation: SOPAdaptiveResult["recommendation"] = {
    action: "HOLD",
    quantity: 0,
    reason: "Stock level is within acceptable range.",
  };

  if (lifecycle === "OBSOLETE") {
    if (projected > max * 1.5) {
      recommendation = {
        action: "REVIEW",
        quantity: 0,
        reason:
          "Significant overstock on an obsoleting SKU. Consider liquidation or demand transfer.",
      };
    } else {
      recommendation = {
        action: "HOLD",
        quantity: 0,
        reason: "Obsolete SKU — avoid replenishment. Monitor remaining demand.",
      };
    }
  } else if (projected < min) {
    const qty = Math.max(max - projected, eoqQty);
    recommendation = {
      action: "ORDER",
      quantity: Math.round(qty),
      reason:
        lifecycle === "NEW"
          ? `New SKU — projected stock (${Math.round(projected)}) below safety threshold (${Math.round(min)}). Order conservatively and monitor demand.`
          : `Stock below reorder point — order ${Math.round(qty)} units to reach Max level.`,
    };
  }

  return {
    lifecycle,
    avgDemand,
    sigma,
    z,
    safetyStock: ss,
    rop,
    min,
    max,
    projected,
    recommendation,
  };
}
