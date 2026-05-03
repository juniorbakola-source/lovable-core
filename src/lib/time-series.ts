/**
 * Séries Temporelles IA — Core Engine
 *
 * World-class time-series forecasting for FlowStockAI, fully integrated with
 * the Gestion SKUs SSOT table (`skus`).
 *
 * Pipeline:
 *   extractSkuFeatures()   — DB row → typed SkuFeatures with safe defaults
 *       ↓
 *   buildForecastSeries()  — historical daily + 30-day Holt-Winters forecast
 *       ↓
 *   computeForecastMetrics() — KPIs: safety stock, ROP, MOQ-constrained order,
 *                              days-of-cover, status, timing
 *
 * Key design principles
 * ─────────────────────
 * - No division by zero: all divisions go through safeDivide().
 * - MOQ=0 means "unconstrained" (moqConstraint = 1 for rounding arithmetic).
 * - All nullable DB fields get safe numeric defaults before any arithmetic.
 * - Structured timing lets callers measure and log compute latency.
 */

import type { Database } from "@/integrations/supabase/types";
import { zScore } from "@/lib/optimizer";

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

// ── Engine constants ──────────────────────────────────────────────────────────

/** Minimum clamped value for service_level (exclusive lower bound) */
const MIN_SERVICE_LEVEL = 0.001;
/** Maximum clamped value for service_level (exclusive upper bound) */
const MAX_SERVICE_LEVEL = 0.999;

/** Holt-Winters level smoothing factor (α): higher = more reactive to recent demand */
const HW_ALPHA = 0.3;
/** Holt-Winters trend smoothing factor (β): higher = trend changes faster */
const HW_BETA = 0.1;

/** Minimum sigma as fraction of blended daily demand (floor for low-volatility SKUs) */
const SIGMA_MIN_FRACTION = 0.15;
/** Absolute minimum sigma value (prevents CI collapsing to a point) */
const SIGMA_FLOOR = 0.5;

/** Horizon (days) at which the HW forecast is fully replaced by the long-run blended average */
const BLENDING_HORIZON_DAYS = 10;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * All SKU fields relevant to time-series analysis, extracted from a Supabase
 * `skus` row with safe numeric defaults applied.
 *
 * Field mapping from Gestion SKUs → SkuFeatures:
 *
 * | DB column               | SkuFeatures field        | Default |
 * |-------------------------|--------------------------|---------|
 * | id                      | id                       | —       |
 * | sku_code                | skuCode                  | ""      |
 * | name                    | name                     | ""      |
 * | category                | category                 | null    |
 * | stock                   | stock                    | 0       |
 * | on_order                | onOrder                  | 0       |
 * | in_production           | inProduction             | 0       |
 * | lead_time_days          | leadTimeDays             | 7       |
 * | moq (0 = unconstrained) | moq                      | 0       |
 * | unit_cost               | unitCost                 | 0       |
 * | service_level           | serviceLevel             | 0.95    |
 * | demand_history          | demandHistory            | []      |
 * | demand_history_yearly   | demandHistoryYearly      | []      |
 * | forecast_3m             | forecast3m               | []      |
 * | min_stock               | minStock                 | null    |
 * | max_stock               | maxStock                 | null    |
 * | ai_min_recommended      | aiMinRecommended         | null    |
 * | ai_max_recommended      | aiMaxRecommended         | null    |
 */
export interface SkuFeatures {
  id: string;
  skuCode: string;
  name: string;
  category: string | null;
  /** Derived: SKU has stock, demand history, or AI recommendation */
  isActive: boolean;
  /** Minimum order quantity. 0 = unconstrained (no MOQ applied to rounding). */
  moq: number;
  leadTimeDays: number;
  /** Target service level 0 < x < 1 */
  serviceLevel: number;
  unitCost: number;
  stock: number;
  onOrder: number;
  inProduction: number;
  minStock: number | null;
  maxStock: number | null;
  aiMinRecommended: number | null;
  aiMaxRecommended: number | null;
  /** 30-day daily demand history (most recent last) */
  demandHistory: number[];
  /** 12-month monthly demand totals */
  demandHistoryYearly: number[];
  /** 3-month forward forecast (monthly totals) */
  forecast3m: number[];
}

/** A single point in the time-series chart */
export interface ForecastPoint {
  /** Date label MM-DD */
  d: string;
  /** Historical daily demand (historical region) */
  hist?: number;
  /** Forecast daily demand — clipped to nearest unit (forecast region) */
  fc?: number;
  /** Lower 90 % confidence bound */
  lo?: number;
  /** Upper 90 % confidence bound */
  hi?: number;
}

/** Computed KPI metrics for the Séries Temporelles IA page */
export interface ForecastMetrics {
  avgDailyDemand: number;
  /** 30-day total forecast — rounded to MOQ if moq > 0 */
  forecast30d: number;
  safetyStock: number;
  reorderPoint: number;
  /** Recommended order quantity — always a multiple of MOQ (or 0 if not needed) */
  recommendedOrder: number;
  daysOfCover: number;
  projectedInventory: number;
  status: "critical" | "low" | "ok" | "overstock";
  /** Whether the SKU has demand data or stock (derived from SkuFeatures.isActive) */
  skuActive: boolean;
  /**
   * True when stock ≥ safety stock AND within configured min/max bounds.
   * Signals that all order constraints are currently satisfied.
   */
  constraintsMet: boolean;
  /** Wall-clock ms to compute — for structured-log observability */
  computeMs: number;
}

// ── Utility guards ────────────────────────────────────────────────────────────

/**
 * Safe division.
 * Returns `fallback` (default 0) when denominator is 0 or non-finite.
 *
 * @example safeDivide(10, 0) → 0
 * @example safeDivide(10, 2) → 5
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (denominator === 0 || !isFinite(denominator)) return fallback;
  return numerator / denominator;
}

/**
 * Round `qty` up to the nearest multiple of `moq`.
 * When `moq <= 0` (unconstrained), qty is returned unchanged (rounded to int).
 *
 * @example roundToMoq(15, 10)  → 20
 * @example roundToMoq(10, 10)  → 10
 * @example roundToMoq(15, 0)   → 15  (no constraint)
 * @example roundToMoq(0,  50)  → 0   (no order needed)
 */
export function roundToMoq(qty: number, moq: number): number {
  if (qty <= 0) return 0;
  const constraint = moq > 0 ? moq : 1;
  return Math.ceil(qty / constraint) * constraint;
}

/**
 * Derive whether a SKU is "active" based on its data:
 * stock > 0, any non-zero demand, or an AI recommendation has been generated.
 */
export function isSkuActive(
  f: Pick<SkuFeatures, "stock" | "demandHistory" | "demandHistoryYearly" | "aiMinRecommended">,
): boolean {
  if (f.stock > 0) return true;
  if (f.demandHistory.some((v) => v > 0)) return true;
  if (f.demandHistoryYearly.some((v) => v > 0)) return true;
  if (f.aiMinRecommended != null) return true;
  return false;
}

// ── Feature extraction ────────────────────────────────────────────────────────

/**
 * Convert a raw Supabase `skus` row into a fully-typed `SkuFeatures` object
 * with all numeric fields clamped to valid ranges and no nulls in arrays.
 */
export function extractSkuFeatures(row: SkuRow): SkuFeatures {
  const demandHistory = (row.demand_history ?? []).map(Number).map((v) => Math.max(0, v));
  const demandHistoryYearly = (row.demand_history_yearly ?? [])
    .map(Number)
    .map((v) => Math.max(0, v));
  const forecast3m = (row.forecast_3m ?? []).map(Number).map((v) => Math.max(0, v));

  const stock = Math.max(0, Number(row.stock ?? 0));
  const onOrder = Math.max(0, Number(row.on_order ?? 0));
  const inProduction = Math.max(0, Number(row.in_production ?? 0));
  const leadTimeDays = Math.max(1, Math.round(Number(row.lead_time_days ?? 7)));
  // moq=0 is valid and means "unconstrained"; keep as-is (do not clamp to 1)
  const moq = Math.max(0, Math.round(Number(row.moq ?? 0)));
  const unitCost = Math.max(0, Number(row.unit_cost ?? 0));
  const serviceLevel = Math.min(
    MAX_SERVICE_LEVEL,
    Math.max(MIN_SERVICE_LEVEL, Number(row.service_level ?? 0.95)),
  );

  const partial = {
    stock,
    demandHistory,
    demandHistoryYearly,
    aiMinRecommended: row.ai_min_recommended != null ? Number(row.ai_min_recommended) : null,
  };

  return {
    id: row.id,
    skuCode: row.sku_code ?? "",
    name: row.name ?? "",
    category: row.category ?? null,
    isActive: isSkuActive(partial),
    moq,
    leadTimeDays,
    serviceLevel,
    unitCost,
    stock,
    onOrder,
    inProduction,
    minStock: row.min_stock != null ? Number(row.min_stock) : null,
    maxStock: row.max_stock != null ? Number(row.max_stock) : null,
    aiMinRecommended: partial.aiMinRecommended,
    aiMaxRecommended: row.ai_max_recommended != null ? Number(row.ai_max_recommended) : null,
    demandHistory,
    demandHistoryYearly,
    forecast3m,
  };
}

// ── Holt-Winters double exponential smoothing ─────────────────────────────────

interface HoltWintersState {
  fitted: number[];
  level: number;
  trend: number;
  /** σ of model residuals (fitted vs actual) */
  residualSigma: number;
}

/**
 * Double exponential smoothing (Holt's linear method).
 *
 * @param series - time series values (e.g., 30 days of daily demand)
 * @param alpha  - level smoothing factor (0 < α < 1); higher = more reactive
 * @param beta   - trend smoothing factor (0 < β < 1); higher = trend changes faster
 */
function holtWinters(series: number[], alpha = HW_ALPHA, beta = HW_BETA): HoltWintersState {
  if (series.length === 0) {
    return { fitted: [], level: 0, trend: 0, residualSigma: 0 };
  }
  if (series.length === 1) {
    return { fitted: [series[0]], level: series[0], trend: 0, residualSigma: 0 };
  }

  let L = series[0];
  let T = series[1] - series[0];
  const fitted: number[] = [Math.max(0, L)];

  for (let i = 1; i < series.length; i++) {
    const y = series[i];
    const Lprev = L;
    L = alpha * y + (1 - alpha) * (Lprev + T);
    T = beta * (L - Lprev) + (1 - beta) * T;
    fitted.push(Math.max(0, L));
  }

  // Residual sigma for confidence interval
  const residuals = series.map((y, i) => y - fitted[i]);
  const meanRes = safeDivide(
    residuals.reduce((a, b) => a + b, 0),
    residuals.length,
  );
  const variance = safeDivide(
    residuals.reduce((acc, r) => acc + (r - meanRes) ** 2, 0),
    Math.max(1, residuals.length - 1),
  );

  return { fitted, level: Math.max(0, L), trend: T, residualSigma: Math.sqrt(variance) };
}

// ── Build time-series chart data ──────────────────────────────────────────────

/**
 * Build a combined historical + 30-day forecast series for the chart.
 *
 * Algorithm:
 * 1. Historical points come from `demandHistory` (daily, last N days).
 * 2. A Holt-Winters model is fitted on `demandHistory`.
 * 3. For the 30-day horizon, HW forecast (level + h × trend) is blended
 *    gradually with the long-run blended daily average to keep the far horizon
 *    grounded.
 * 4. 90 % confidence interval widens with √h (standard Gaussian approximation).
 */
export function buildForecastSeries(f: SkuFeatures): ForecastPoint[] {
  const today = new Date();
  const points: ForecastPoint[] = [];

  const hist = f.demandHistory;

  // ── Historical points ──────────────────────────────────────────────────────
  for (let i = hist.length - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - (i + 1));
    points.push({
      d: dt.toISOString().slice(5, 10),
      hist: Math.max(0, hist[hist.length - 1 - i]),
    });
  }

  // ── Demand signal (blended) ────────────────────────────────────────────────
  const yearly = f.demandHistoryYearly;
  const fc3m = f.forecast3m;

  const avgDaily30 = safeDivide(
    hist.reduce((a, b) => a + b, 0),
    hist.length,
  );
  const avgDailyYearly =
    yearly.length > 0
      ? safeDivide(
          yearly.reduce((a, b) => a + b, 0),
          yearly.length * 30,
        )
      : avgDaily30;
  const avgDailyForecast =
    fc3m.length > 0
      ? safeDivide(
          fc3m.reduce((a, b) => a + b, 0),
          fc3m.length * 30,
        )
      : avgDailyYearly;
  const blendedDaily =
    fc3m.length > 0 ? avgDailyForecast * 0.6 + avgDailyYearly * 0.4 : avgDailyYearly;

  // ── Holt-Winters fit ───────────────────────────────────────────────────────
  const hw = holtWinters(hist.length > 0 ? hist : [0]);
  const sigma = Math.max(hw.residualSigma, blendedDaily * SIGMA_MIN_FRACTION, SIGMA_FLOOR);

  // ── Forecast horizon ───────────────────────────────────────────────────────
  for (let h = 1; h <= 30; h++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + h);

    // Blend HW toward long-run average over the horizon
    const hwFc = Math.max(0, hw.level + h * hw.trend);
    const weight = Math.min(1, h / BLENDING_HORIZON_DAYS); // fully blended at BLENDING_HORIZON_DAYS
    const rawFc = hwFc * (1 - weight) + blendedDaily * weight;
    const fc = Math.max(0, Math.round(rawFc));

    const widening = 1 + h / 30; // widening CI
    const lo = Math.max(0, Math.round(fc - 1.65 * sigma * widening));
    const hi = Math.round(fc + 1.65 * sigma * widening);

    points.push({ d: dt.toISOString().slice(5, 10), fc, lo, hi });
  }

  return points;
}

// ── Compute KPI metrics ────────────────────────────────────────────────────────

/**
 * Compute all KPI metrics for the Séries Temporelles IA page.
 *
 * SKU constraints applied:
 * - MOQ: `recommendedOrder` is always a multiple of `moq` (moq=0 → unconstrained).
 * - `forecast30d` is rounded up to MOQ when moq > 0.
 * - `constraintsMet` reflects stock vs safety stock and manual min/max bounds.
 *
 * @returns ForecastMetrics — all fields are safe numbers (no Infinity, no NaN).
 */
export function computeForecastMetrics(f: SkuFeatures): ForecastMetrics {
  const t0 = Date.now();

  // ── Demand signal ──────────────────────────────────────────────────────────
  const hist = f.demandHistory.length > 0 ? f.demandHistory : [0];
  const yearly = f.demandHistoryYearly;
  const fc3m = f.forecast3m;

  const avg30 = safeDivide(
    hist.reduce((a, b) => a + b, 0),
    hist.length,
  );
  const avgYearly =
    yearly.length > 0
      ? safeDivide(
          yearly.reduce((a, b) => a + b, 0),
          yearly.length * 30,
        )
      : avg30;
  const avgForecast =
    fc3m.length > 0
      ? safeDivide(
          fc3m.reduce((a, b) => a + b, 0),
          fc3m.length * 30,
        )
      : avgYearly;
  const avgDailyDemand = fc3m.length > 0 ? avgForecast * 0.6 + avgYearly * 0.4 : avgYearly;

  // ── Demand variability ─────────────────────────────────────────────────────
  const variance =
    hist.length > 1
      ? safeDivide(
          hist.reduce((acc, v) => acc + (v - avg30) ** 2, 0),
          hist.length - 1,
        )
      : Math.max(avg30, 1);
  const sigma = Math.sqrt(variance);

  // ── Safety stock & reorder point ───────────────────────────────────────────
  const z = zScore(f.serviceLevel);
  const lt = f.leadTimeDays;
  const safetyStock = Math.ceil(z * sigma * Math.sqrt(lt));
  const reorderPoint = Math.ceil(avgDailyDemand * lt + safetyStock);

  // ── Projected inventory ────────────────────────────────────────────────────
  const pipeline = f.onOrder + f.inProduction;
  const projectedInventory = Math.round(f.stock + pipeline - avgDailyDemand * lt);

  // ── 30-day forecast with MOQ rounding ─────────────────────────────────────
  const raw30 = Math.round(avgDailyDemand * 30);
  const forecast30d = f.moq > 0 ? roundToMoq(raw30, f.moq) : raw30;

  // ── Recommended order — multiple of MOQ ───────────────────────────────────
  const moqConstraint = f.moq > 0 ? f.moq : 1;
  let recommendedOrder = 0;
  if (f.stock + pipeline < reorderPoint) {
    const target = reorderPoint + safetyStock;
    const gap = Math.max(target - (f.stock + pipeline), moqConstraint);
    recommendedOrder = roundToMoq(gap, f.moq);
  }

  // ── Days of cover ──────────────────────────────────────────────────────────
  const daysOfCover =
    avgDailyDemand > 0 ? Math.round(safeDivide(f.stock + pipeline, avgDailyDemand)) : 999;

  // ── Status ─────────────────────────────────────────────────────────────────
  let status: ForecastMetrics["status"] = "ok";
  if (f.stock <= safetyStock) status = "critical";
  else if (f.stock < reorderPoint) status = "low";
  else if (daysOfCover > 90) status = "overstock";

  // ── Constraint check ───────────────────────────────────────────────────────
  const constraintsMet =
    f.stock >= safetyStock &&
    (f.minStock == null || f.stock >= f.minStock) &&
    (f.maxStock == null || f.stock <= f.maxStock);

  return {
    avgDailyDemand,
    forecast30d,
    safetyStock,
    reorderPoint,
    recommendedOrder,
    daysOfCover,
    projectedInventory,
    status,
    skuActive: f.isActive,
    constraintsMet,
    computeMs: Date.now() - t0,
  };
}
