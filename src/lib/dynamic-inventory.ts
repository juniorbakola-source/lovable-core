import type { Database } from "@/integrations/supabase/types";

export interface InventoryConfig {
  orderingCost: number;
  holdingRate: number;
  serviceLevel: number;
  leadTimeDays: number;
  businessDaysYear: number;
  forecastWeight: number;
  historyWeight: number;
  volatilityThreshold: number;
  reviewPeriodDays: number;
}

export interface InventorySku {
  id: string;
  skuCode: string;
  unitCost: number;
  stock: number;
  reserved: number;
  onOrder: number;
  inProduction: number;
  leadTimeDays?: number | null;
  serviceLevel?: number | null;
  moq?: number | null;
  demandHistory: number[];
  yearlyHistory: number[];
  forecast3m: number[];
  createdAt?: string | null;
}

export interface InventoryResult {
  skuId: string;
  skuCode: string;
  annualDemand: number;
  dailyDemand: number;
  volatility: number;
  coverageTargetDays: number;
  safetyStock: number;
  reorderPoint: number;
  maxQty: number;
  eoq: number;
  stock: number;
  reserved: number;
  onOrder: number;
  inProduction: number;
  availableStock: number;
  effectiveStock: number;
  currentCoverageDays: number;
  seasonal: boolean;
  immature: boolean;
  action: string;
  recommendations: string[];
  recommendedOrderQty: number;
  recommendation: string;
  isSeasonal: boolean;
  isImmature: boolean;
  isVolatile: boolean;
  maxQuantity: number;
}

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

export const INFINITE_COVERAGE_DAYS = 9999;

const Z_TABLE: Record<string, number> = {
  "0.90": 1.282,
  "0.95": 1.645,
  "0.97": 1.881,
  "0.99": 2.326,
};

export const DEFAULT_CONFIG: InventoryConfig = {
  orderingCost: 50,
  holdingRate: 0.25,
  serviceLevel: 0.95,
  leadTimeDays: 14,
  businessDaysYear: 260,
  forecastWeight: 0.5,
  historyWeight: 0.5,
  volatilityThreshold: 0.2,
  reviewPeriodDays: 7,
};

const safeNum = (value: unknown, fallback = 0) => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
};

const sum = (values?: number[]) => (values ?? []).reduce((acc, value) => acc + safeNum(value), 0);

const avg = (values?: number[]) => {
  if (!values?.length) return 0;
  return sum(values) / values.length;
};

const stddev = (values?: number[]) => {
  if (!values?.length) return 0;
  const mean = avg(values);
  const variance =
    values.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / Math.max(values.length, 1);
  return Math.sqrt(variance);
};

function zScore(serviceLevel: number) {
  const nearest = Object.keys(Z_TABLE).reduce((a, b) =>
    Math.abs(Number(b) - serviceLevel) < Math.abs(Number(a) - serviceLevel) ? b : a,
  );
  return Z_TABLE[nearest];
}

function summarizeActionAndRecommendations(
  effectiveStock: number,
  reorderPoint: number,
  maxQty: number,
  currentCoverageDays: number,
  leadTimeDays: number,
  reserved: number,
  stock: number,
  seasonal: boolean,
  volatility: number,
  immature: boolean,
) {
  const recommendations: string[] = [];

  let action = "🟢 OK";
  if (effectiveStock < reorderPoint) action = "🔴 ORDER NOW";
  else if (effectiveStock > maxQty) action = "🟢 OVERSTOCK";

  if (currentCoverageDays < leadTimeDays) recommendations.push("🔴 Risk of stockout");
  if (effectiveStock > maxQty * 1.3) recommendations.push("⚠ Overstock risk");
  if (reserved > stock * 0.5) recommendations.push("⚠ High reserved stock ratio");
  if (reserved > stock) recommendations.push("🔴 Reserved exceeds stock");
  if (seasonal) recommendations.push("📈 Seasonal demand");
  if (volatility > 0.5) recommendations.push("⚠ High demand volatility");
  if (immature) recommendations.push("⚠ Immature SKU");

  const recommendation = recommendations.length > 0 ? recommendations.join(" · ") : "RAS";

  return {
    action,
    recommendations,
    recommendation,
  };
}

export function toInventorySku(row: SkuRow): InventorySku {
  const rowWithReserved = row as SkuRow & { reserved?: number | null };

  return {
    id: row.id,
    skuCode: row.sku_code ?? row.name ?? row.id.slice(0, 8),
    unitCost: safeNum(row.unit_cost),
    stock: safeNum(row.stock),
    reserved: safeNum(rowWithReserved.reserved),
    onOrder: safeNum(row.on_order),
    inProduction: safeNum(row.in_production),
    leadTimeDays: row.lead_time_days,
    serviceLevel: row.service_level,
    moq: row.moq,
    demandHistory: (row.demand_history ?? []) as number[],
    yearlyHistory: (row.demand_history_yearly ?? []) as number[],
    forecast3m: (row.forecast_3m ?? []) as number[],
    createdAt: row.created_at,
  };
}

export function calculateWeeklyInventory(
  sku: InventorySku,
  cfg: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult {
  const history = sku.demandHistory ?? [];
  const yearly = sku.yearlyHistory ?? [];
  const forecast = sku.forecast3m ?? [];

  const recentHistory3m = sum(history.slice(-3));
  const recentForecast3m = sum(forecast.slice(-3));

  const annualHistory = yearly.length > 0 ? sum(yearly) : sum(history.slice(-12));

  const recentSignal = recentForecast3m * cfg.forecastWeight + recentHistory3m * cfg.historyWeight;
  const annualRecent = recentSignal * 4;

  const seasonalRatio =
    annualHistory > 0 ? Math.abs(annualRecent - annualHistory) / Math.max(annualHistory, 1) : 0;
  const seasonal = seasonalRatio > cfg.volatilityThreshold;

  let immature = false;
  if (sku.createdAt) {
    const created = new Date(sku.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const ageDays = (Date.now() - created.getTime()) / 86_400_000;
      immature = ageDays < 365;
    }
  }

  let annualDemand = 0;
  if (immature && annualHistory <= 0) {
    annualDemand = annualRecent;
  } else if (seasonal) {
    annualDemand = Math.max(annualRecent, annualHistory);
  } else {
    const recentWeight = immature ? 0.6 : 0.3;
    annualDemand = recentWeight * annualRecent + (1 - recentWeight) * annualHistory;
  }
  annualDemand = Math.max(annualDemand, 0);

  const businessDaysYear = Math.max(cfg.businessDaysYear, 1);
  const leadTimeDays = Math.max(safeNum(sku.leadTimeDays, cfg.leadTimeDays), 0);
  const serviceLevel = Math.min(Math.max(safeNum(sku.serviceLevel, cfg.serviceLevel), 0.9), 0.99);

  const dailyDemand = annualDemand / businessDaysYear;

  const monthlyHistory = history.slice(-12);
  const monthlyAverage = avg(monthlyHistory);
  const monthlyStdDev = stddev(monthlyHistory);
  const volatility = monthlyAverage > 0 ? monthlyStdDev / monthlyAverage : 0;

  let coverageTargetDays = 20;
  if (volatility > 0.5) coverageTargetDays = 45;
  else if (volatility > 0.25) coverageTargetDays = 30;
  if (seasonal) coverageTargetDays += 10;
  if (immature) coverageTargetDays += 10;

  const sigmaDaily = monthlyStdDev / Math.max(businessDaysYear / 12, 1);
  const safetyStock = zScore(serviceLevel) * sigmaDaily * Math.sqrt(leadTimeDays);

  const reorderPoint = dailyDemand * leadTimeDays + safetyStock;

  const holdingCost = Math.max(sku.unitCost * cfg.holdingRate, 0.1);
  const rawEOQ =
    annualDemand > 0
      ? Math.sqrt((2 * annualDemand * cfg.orderingCost) / Math.max(holdingCost, 0.1))
      : 0;
  const eoq = Math.max(Math.round(rawEOQ), 1);

  const stock = safeNum(sku.stock);
  const reserved = safeNum(sku.reserved);
  const availableStock = Math.max(stock - reserved, 0);
  const onOrder = safeNum(sku.onOrder);
  const inProduction = safeNum(sku.inProduction);
  const effectiveStock = availableStock + onOrder + inProduction;

  const replenishmentBuffer = dailyDemand * coverageTargetDays;
  const maxQty = reorderPoint + replenishmentBuffer;

  const currentCoverageDays =
    dailyDemand > 0 ? effectiveStock / dailyDemand : INFINITE_COVERAGE_DAYS;

  const summary = summarizeActionAndRecommendations(
    effectiveStock,
    reorderPoint,
    maxQty,
    currentCoverageDays,
    leadTimeDays,
    reserved,
    stock,
    seasonal,
    volatility,
    immature,
  );

  const recommendedOrderQty =
    summary.action === "🔴 ORDER NOW"
      ? Math.max(Math.round(Math.max(maxQty - effectiveStock, safeNum(sku.moq, 0))), 0)
      : 0;

  return {
    skuId: sku.id,
    skuCode: sku.skuCode,
    annualDemand,
    dailyDemand,
    volatility,
    coverageTargetDays,
    safetyStock,
    reorderPoint,
    maxQty,
    eoq,
    stock,
    reserved,
    onOrder,
    inProduction,
    availableStock,
    effectiveStock,
    currentCoverageDays,
    seasonal,
    immature,
    action: summary.action,
    recommendations: summary.recommendations,
    recommendedOrderQty,
    recommendation: summary.recommendation,
    isSeasonal: seasonal,
    isImmature: immature,
    isVolatile: volatility > 0.5,
    maxQuantity: maxQty,
  };
}

export function calculateDynamicInventory(
  sku: InventorySku,
  config: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult {
  return calculateWeeklyInventory(sku, config);
}

export function runWeeklyRecalculation(
  skus: InventorySku[],
  cfg: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult[] {
  return skus.map((sku) => calculateWeeklyInventory(sku, cfg));
}

export function weeklyRecalculation(
  skus: InventorySku[],
  config: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult[] {
  return runWeeklyRecalculation(skus, config);
}
