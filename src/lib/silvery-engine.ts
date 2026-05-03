/**
 * Silvery Engine — S&OP-aligned inventory optimization calculations
 *
 * Computes for each SKU:
 *  - Safety stock (Wilson / z-score method)
 *  - EOQ (Economic Order Quantity — Wilson formula)
 *  - Break-even quantity & value
 *  - Optimised Min / Max
 *  - Recommended order quantity
 *  - SKU status (ok / low / critical / overstock)
 *  - Days of cover
 *
 * All formulas are deterministic and traceable; the full input snapshot is
 * stored alongside the results in silvery_engine_results for audit.
 */

import { zScore, type SkuInput } from "@/lib/optimizer";
import { safeNum } from "@/lib/sku-helpers";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SilveryResult {
  /** Optimised minimum stock (safety stock + lead-time demand) */
  minOptimized: number;
  /** Optimised maximum stock (min + EOQ, rounded to MOQ) */
  maxOptimized: number;
  /** Safety stock units */
  safetyStock: number;
  /** Economic Order Quantity */
  eoq: number;
  /** Recommended order quantity (0 if no action needed) */
  recommendedOrder: number;
  /** Break-even quantity (fixed_cost / margin) — stub; see note below */
  breakEvenQty: number;
  /** Break-even value in currency */
  breakEvenValue: number;
  /** SKU status */
  status: "ok" | "low" | "critical" | "overstock";
  /** Projected days of cover */
  daysOfCover: number;
  /** Average daily demand used for calculations */
  avgDailyDemand: number;
  /** Reorder point */
  reorderPoint: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Run the Silvery Engine on a single SKU input.
 *
 * @param s       - The SKU inputs (stock levels, demand history, etc.)
 * @param margin  - Gross margin ratio (0–1). Used for break-even calc.
 *                  Defaults to 0.30 (30 %) as a safe assumption when unknown.
 *                  TODO: source from product catalogue when available.
 * @param orderingCost - Fixed cost per order (e.g., $50).
 *                  Defaults to 50. TODO: source from settings.
 * @param holdingRate  - Annual holding cost rate (fraction of unit cost).
 *                  Defaults to 0.20 (20 %).
 */
export function runSilveryEngine(
  s: SkuInput,
  margin = 0.3,
  orderingCost = 50,
  holdingRate = 0.2,
): SilveryResult {
  // ── 1. Demand signal ──────────────────────────────────────────────────────
  const history30 = s.demand_history.length ? s.demand_history : [0];
  const avgDaily30 = history30.reduce((a, b) => a + b, 0) / history30.length;

  // Blend 12-month history + 3-month forecast (60/40 forward-looking weight)
  const yearly = s.demand_history_yearly ?? [];
  const forecast3m = s.forecast_3m ?? [];
  const avgDailyHist = yearly.length
    ? yearly.reduce((a, b) => a + b, 0) / (yearly.length * 30)
    : avgDaily30;
  const avgDailyFcast = forecast3m.length
    ? forecast3m.reduce((a, b) => a + b, 0) / (forecast3m.length * 30)
    : avgDailyHist;
  const blended = forecast3m.length ? avgDailyFcast * 0.6 + avgDailyHist * 0.4 : avgDailyHist;

  // Demand variability (std-dev of 30-day history)
  const mean30 = avgDaily30;
  const variance30 =
    history30.length > 1
      ? history30.reduce((acc, v) => acc + (v - mean30) ** 2, 0) / (history30.length - 1)
      : Math.max(mean30, 1);
  const sigma = Math.sqrt(variance30);

  const lt = safeNum(s.lead_time_days, 7);
  const z = zScore(safeNum(s.service_level, 0.95));

  // ── 2. Safety stock ───────────────────────────────────────────────────────
  const safetyStock = Math.ceil(z * sigma * Math.sqrt(lt));

  // ── 3. Reorder point ──────────────────────────────────────────────────────
  const reorderPoint = Math.ceil(blended * lt + safetyStock);

  // ── 4. EOQ (Wilson formula) ───────────────────────────────────────────────
  // EOQ = sqrt( 2 * D * S / (H * C) )
  // D = annual demand, S = ordering cost, H = holding rate, C = unit cost
  const annualDemand = blended * 365;
  const unitCost = safeNum(s.unit_cost, 0);
  const holdingCostPerUnit = unitCost > 0 ? holdingRate * unitCost : holdingRate;
  const moq = Math.max(1, safeNum(s.moq, 1));
  let eoqRaw = 0;
  if (annualDemand > 0 && holdingCostPerUnit > 0) {
    eoqRaw = Math.sqrt((2 * annualDemand * orderingCost) / holdingCostPerUnit);
  }
  // Round up to nearest MOQ
  const eoq = moq * Math.max(1, Math.ceil(eoqRaw / moq));

  // ── 5. Min / Max (optimised) ──────────────────────────────────────────────
  const minOptimized = Math.max(0, reorderPoint);
  const rawMax = minOptimized + Math.max(eoq, moq);
  const maxOptimized = Math.ceil(rawMax / moq) * moq;

  // ── 6. Projected inventory & recommended order ───────────────────────────
  const pipeline = safeNum(s.on_order, 0) + safeNum(s.in_production, 0);
  const projected = safeNum(s.stock, 0) + pipeline;
  let recommendedOrder = 0;
  if (projected < reorderPoint) {
    const target = maxOptimized;
    recommendedOrder = moq * Math.ceil(Math.max(target - projected, moq) / moq);
  }

  // ── 7. Status ─────────────────────────────────────────────────────────────
  const daysOfCover = blended > 0 ? Math.round((safeNum(s.stock, 0) + pipeline) / blended) : 999;

  let status: SilveryResult["status"] = "ok";
  if (safeNum(s.stock, 0) <= safetyStock) status = "critical";
  else if (safeNum(s.stock, 0) < reorderPoint) status = "low";
  else if (daysOfCover > 90) status = "overstock";

  // ── 8. Break-even ─────────────────────────────────────────────────────────
  // Break-even = Fixed ordering cost / (unit_price - unit_cost)
  // We approximate unit_price = unit_cost / (1 - margin)
  // TODO: source actual selling price from a product catalogue when available.
  const unitPrice = margin < 1 && margin > 0 ? unitCost / (1 - margin) : unitCost;
  const unitMargin = unitPrice - unitCost;
  const breakEvenQty = unitMargin > 0 ? Math.ceil(orderingCost / unitMargin) : 0;
  const breakEvenValue = breakEvenQty * unitPrice;

  return {
    minOptimized,
    maxOptimized,
    safetyStock,
    eoq,
    recommendedOrder,
    breakEvenQty,
    breakEvenValue,
    status,
    daysOfCover,
    avgDailyDemand: blended,
    reorderPoint,
  };
}
