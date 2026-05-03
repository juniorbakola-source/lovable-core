# Séries Temporelles IA — Module Documentation

## Overview

The **Séries Temporelles IA** module provides demand forecasting and inventory KPIs
for each SKU. It is built on top of the **Gestion SKUs SSOT** table as its single source
of truth and uses a **Holt-Winters double exponential smoothing** model for time-series
predictions.

```
Gestion SKUs (skus table)
        │
        ▼ extractSkuFeatures()
     SkuFeatures     ← typed, all fields safe (no nulls, no Infinity)
        │
        ├──► buildForecastSeries()  → ForecastPoint[]  (chart data)
        │
        └──► computeForecastMetrics() → ForecastMetrics (KPIs)
```

---

## Integration with Gestion SKUs

Every field used by the forecasting engine is read directly from the `skus` table.
No secondary data sources are required.

### Field Mapping: `skus` → `SkuFeatures`

| DB column               | `SkuFeatures` field  | Safe default | Role in forecasting                          |
| ----------------------- | -------------------- | ------------ | -------------------------------------------- |
| `id`                    | `id`                 | —            | Row identifier                               |
| `sku_code`              | `skuCode`            | `""`         | Display label                                |
| `name`                  | `name`               | `""`         | Display label                                |
| `category`              | `category`           | `null`       | Informational                                |
| `stock`                 | `stock`              | `0`          | Current on-hand qty (status, coverage)       |
| `on_order`              | `onOrder`            | `0`          | In-transit pipeline (projected inventory)    |
| `in_production`         | `inProduction`       | `0`          | Manufacturing pipeline                       |
| `lead_time_days`        | `leadTimeDays`       | `7`          | Safety stock & ROP calculation               |
| `moq`                   | `moq`                | `0`          | Order rounding; `0` = unconstrained          |
| `unit_cost`             | `unitCost`           | `0`          | Stock value display                          |
| `service_level`         | `serviceLevel`       | `0.95`       | z-score for safety stock                     |
| `demand_history`        | `demandHistory`      | `[]`         | 30-day daily history → Holt-Winters model    |
| `demand_history_yearly` | `demandHistoryYearly`| `[]`         | 12-month monthly totals → blended demand     |
| `forecast_3m`           | `forecast3m`         | `[]`         | 3-month forward forecast → blended demand    |
| `min_stock`             | `minStock`           | `null`       | Manual floor constraint (constraintsMet)     |
| `max_stock`             | `maxStock`           | `null`       | Manual ceiling constraint (constraintsMet)   |
| `ai_min_recommended`    | `aiMinRecommended`   | `null`       | Silvery Engine recommendation (display)      |
| `ai_max_recommended`    | `aiMaxRecommended`   | `null`       | Silvery Engine recommendation (display)      |

### `isActive` derivation

A SKU is considered **active** when at least one of these is true:
- `stock > 0`
- any value in `demandHistory` is `> 0`
- any value in `demandHistoryYearly` is `> 0`
- `aiMinRecommended != null`

Inactive SKUs display a warning banner on the forecasting page and their metrics
are computed from default values (demand = 0).

---

## Forecasting Algorithm

### `buildForecastSeries(f: SkuFeatures): ForecastPoint[]`

Produces a combined historical + 30-day forecast series for the chart.

**Steps:**

1. **Historical points**: raw values from `demandHistory` mapped to the past N days.
2. **Holt-Winters fit**: double exponential smoothing (α=0.3, β=0.1) on `demandHistory`.
   - Level: `L[t] = α·y[t] + (1−α)·(L[t−1] + T[t−1])`
   - Trend: `T[t] = β·(L[t] − L[t−1]) + (1−β)·T[t−1]`
3. **Blended daily demand**: weighted average of `forecast_3m` (60 %) and yearly history (40 %).
4. **Horizon forecast**: for each day `h = 1..30`:
   - `hwFc = level + h × trend` (Holt-Winters projection)
   - Blended gradually toward long-run average at h=10 for stability
   - `σ = max(residualSigma, blended × 0.15, 0.5)`
   - 90 % CI: `fc ± 1.65 × σ × √(1 + h/30)` (widening cone)
5. All values clamped ≥ 0.

### `computeForecastMetrics(f: SkuFeatures): ForecastMetrics`

Computes inventory KPIs with all SKU constraints applied.

| Metric             | Formula                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `avgDailyDemand`   | Blended: `forecast3m×0.6 + yearly×0.4` (falls back to 30-day history)        |
| `safetyStock`      | `⌈z(serviceLevel) × σ × √(leadTimeDays)⌉`                                   |
| `reorderPoint`     | `⌈avgDailyDemand × leadTimeDays + safetyStock⌉`                              |
| `forecast30d`      | `round(avgDailyDemand × 30)` — rounded **up** to MOQ when `moq > 0`          |
| `recommendedOrder` | `roundToMoq(gap, moq)` when `stock + pipeline < ROP`; else `0`               |
| `daysOfCover`      | `(stock + pipeline) / avgDailyDemand`; `999` when demand = 0                 |
| `constraintsMet`   | `stock ≥ safetyStock AND stock ∈ [minStock, maxStock]`                        |

---

## MOQ Constraint Handling

`moq = 0` means **unconstrained** — no rounding is applied to order quantities.
This matches the convention in `src/lib/optimizer.ts` and `src/lib/silvery-engine.ts`.

```
moq = 0   →  roundToMoq(qty, 0) = qty          (no rounding)
moq = 50  →  roundToMoq(15, 50)  = 50   (rounds up to next multiple)
moq = 50  →  roundToMoq(100, 50) = 100  (exact multiple, unchanged)
```

---

## Safe Numeric Operations

All arithmetic is protected by two guards:

```typescript
// Safe division — returns fallback (default 0) when denominator is 0 or non-finite
safeDivide(numerator, denominator, fallback?)

// Round qty up to nearest MOQ multiple; moq=0 → no rounding
roundToMoq(qty, moq)
```

No code in `time-series.ts` divides by a user-supplied value without going through
`safeDivide`, preventing `Infinity` / `NaN` from propagating to the UI.

---

## API (exported functions)

```typescript
// src/lib/time-series.ts

extractSkuFeatures(row: SkuRow): SkuFeatures
buildForecastSeries(f: SkuFeatures): ForecastPoint[]
computeForecastMetrics(f: SkuFeatures): ForecastMetrics

safeDivide(n: number, d: number, fallback?: number): number
roundToMoq(qty: number, moq: number): number
isSkuActive(f: Pick<SkuFeatures, "stock" | "demandHistory" | "demandHistoryYearly" | "aiMinRecommended">): boolean
```

---

## Running Tests

```bash
# One-shot (CI)
npm test

# Watch mode (development)
npm run test:watch
```

Test file: `src/lib/time-series.test.ts`

### Test coverage

| Area                     | Cases                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| `safeDivide`             | zero denominator, Infinity, NaN, normal division                   |
| `roundToMoq`             | MOQ=0, MOQ=1, rounds up, exact multiple, qty=0, large MOQ          |
| `isSkuActive`            | stock>0, demand history, yearly history, AI reco, all zero/null    |
| `extractSkuFeatures`     | full row, MOQ=0 preserved, null row defaults, negative clamping    |
| `computeForecastMetrics` | MOQ=0/>0 rounding, recommendedOrder, inactive SKU, status, timing  |
| `buildForecastSeries`    | 30 forecast points, historical length, no negatives/NaN, CI widens |

---

## Observability

`ForecastMetrics.computeMs` records the wall-clock milliseconds taken to compute
metrics for a single SKU. This value is displayed in the page subtitle and can be
forwarded to structured logs or metrics dashboards.

```typescript
const metrics = computeForecastMetrics(features);
console.info("[forecasting]", {
  skuCode: features.skuCode,
  computeMs: metrics.computeMs,
  status: metrics.status,
  avgDailyDemand: metrics.avgDailyDemand,
});
```
