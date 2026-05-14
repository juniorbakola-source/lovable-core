import type { Database } from "@/integrations/supabase/types";

export interface InventoryConfig {
  orderingCost: number;
  holdingRate: number;
  leadTimeDays: number;
  serviceLevel: number;
  businessDaysPerYear: number;
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
  onOrder: number;
  inProduction: number;
  leadTimeDays?: number | null;
  serviceLevel?: number | null;
  moq?: number | null;
  demandHistory: number[];
  demandHistoryYearly: number[];
  forecast3m: number[];
  createdAt?: string | null;
}

export interface InventoryResult {
  skuId: string;
  skuCode: string;
  annualHistory: number;
  annualRecent: number;
  annualDemand: number;
  dailyDemand: number;
  coverageTargetDays: number;
  safetyStock: number;
  reorderPoint: number;
  maxQuantity: number;
  effectiveStock: number;
  currentCoverageDays: number;
  volatility: number;
  isSeasonal: boolean;
  isImmature: boolean;
  isVolatile: boolean;
  recommendedOrderQty: number;
  recommendation: string;
}

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

const Z_TABLE: Record<string, number> = {
  "0.8": 0.842,
  "0.85": 1.036,
  "0.9": 1.282,
  "0.95": 1.645,
  "0.97": 1.881,
  "0.99": 2.326,
};

export const DEFAULT_CONFIG: InventoryConfig = {
  orderingCost: 50,
  holdingRate: 0.25,
  leadTimeDays: 14,
  serviceLevel: 0.95,
  businessDaysPerYear: 260,
  forecastWeight: 0.6,
  historyWeight: 0.4,
  volatilityThreshold: 0.35,
  reviewPeriodDays: 30,
};

const safeNum = (value: unknown, fallback = 0) => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
};

const sum = (values: number[]) => values.reduce((acc, value) => acc + safeNum(value), 0);

const avg = (values: number[]) => (values.length > 0 ? sum(values) / values.length : 0);

const stdDev = (values: number[]) => {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
};

function parseSkuDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() < 1900 || parsed.getTime() > Date.now()) return null;
  return parsed;
}

function zScore(serviceLevel: number): number {
  const nearest = Object.keys(Z_TABLE).reduce((a, b) =>
    Math.abs(parseFloat(b) - serviceLevel) < Math.abs(parseFloat(a) - serviceLevel) ? b : a,
  );
  return Z_TABLE[nearest];
}

function normalizeWeights(forecastWeight: number, historyWeight: number) {
  const f = Math.max(forecastWeight, 0);
  const h = Math.max(historyWeight, 0);
  const total = f + h;
  if (total <= 0) return { forecast: 0.5, history: 0.5 };
  return { forecast: f / total, history: h / total };
}

export function toInventorySku(row: SkuRow): InventorySku {
  return {
    id: row.id,
    skuCode: row.sku_code ?? row.name ?? row.id.slice(0, 8),
    unitCost: safeNum(row.unit_cost),
    stock: safeNum(row.stock),
    onOrder: safeNum(row.on_order),
    inProduction: safeNum(row.in_production),
    leadTimeDays: row.lead_time_days,
    serviceLevel: row.service_level,
    moq: row.moq,
    demandHistory: (row.demand_history ?? []) as number[],
    demandHistoryYearly: (row.demand_history_yearly ?? []) as number[],
    forecast3m: (row.forecast_3m ?? []) as number[],
    createdAt: row.created_at,
  };
}

export function calculateDynamicInventory(
  sku: InventorySku,
  config: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult {
  const annualHistory =
    sku.demandHistoryYearly.length > 0
      ? sum(sku.demandHistoryYearly)
      : sum(sku.demandHistory.slice(-12));
  const annualRecent =
    (sku.forecast3m.length > 0 ? sum(sku.forecast3m.slice(-3)) : sum(sku.demandHistory.slice(-3))) *
    4;
  const weights = normalizeWeights(config.forecastWeight, config.historyWeight);

  let annualDemand = annualRecent * weights.forecast + annualHistory * weights.history;
  if (annualHistory <= 0 && annualRecent > 0) annualDemand = annualRecent;
  if (annualRecent <= 0 && annualHistory > 0) annualDemand = annualHistory;
  annualDemand = Math.max(annualDemand, 0);

  const businessDaysPerYear = Math.max(config.businessDaysPerYear, 1);
  const dailyDemand = annualDemand / businessDaysPerYear;

  const leadTimeDays = Math.max(safeNum(sku.leadTimeDays, config.leadTimeDays), 0);
  const serviceLevel = Math.min(
    Math.max(safeNum(sku.serviceLevel, config.serviceLevel), 0.8),
    0.99,
  );
  const z = zScore(serviceLevel);

  const monthlySeries =
    sku.demandHistoryYearly.length > 0 ? sku.demandHistoryYearly : sku.demandHistory.slice(-12);
  const meanMonthly = avg(monthlySeries);
  const sigmaMonthly = stdDev(monthlySeries);
  const volatility = meanMonthly > 0 ? sigmaMonthly / meanMonthly : 0;
  const isVolatile = volatility >= config.volatilityThreshold;
  const monthlyToDailyDivisor = Math.max(businessDaysPerYear / 12, 1);
  const sigmaDaily = Math.max(sigmaMonthly / monthlyToDailyDivisor, dailyDemand * 0.1);

  const isSeasonal =
    annualHistory > 0 && Math.abs(annualRecent - annualHistory) / Math.max(annualHistory, 1) > 0.2;

  const createdAt = parseSkuDate(sku.createdAt);
  const ageDays = createdAt ? (Date.now() - createdAt.getTime()) / 86_400_000 : null;
  const isImmature = ageDays !== null && ageDays >= 0 && ageDays < 365;

  const safetyMultiplier = 1 + Math.max(0, volatility - config.volatilityThreshold);
  const seasonalityMultiplier = isSeasonal ? 1.1 : 1;
  const safetyStock = Math.max(
    0,
    Math.round(
      z *
        sigmaDaily *
        Math.sqrt(Math.max(leadTimeDays, 1)) *
        safetyMultiplier *
        seasonalityMultiplier,
    ),
  );
  const reorderPoint = Math.max(0, Math.round(dailyDemand * leadTimeDays + safetyStock));
  const coverageTargetDays = Math.max(config.reviewPeriodDays + leadTimeDays, leadTimeDays);

  const holdingCost = Math.max(config.holdingRate * Math.max(sku.unitCost, 0), 0.1);
  const eoqRaw =
    annualDemand > 0 && config.orderingCost > 0
      ? Math.sqrt((2 * annualDemand * config.orderingCost) / holdingCost)
      : 0;
  const baseCycle = Math.max(Math.round(dailyDemand * coverageTargetDays), 0);
  const eoq = Math.max(Math.round(eoqRaw), baseCycle);
  const maxQuantity = Math.max(reorderPoint + eoq, reorderPoint);

  const effectiveStock = Math.max(0, sku.stock + sku.onOrder + sku.inProduction);
  const currentCoverageDays = dailyDemand > 0 ? effectiveStock / dailyDemand : 9999;

  const moq = Math.max(safeNum(sku.moq, 0), 0);
  const shortage = Math.max(0, reorderPoint - effectiveStock);
  const isOverstock = effectiveStock > maxQuantity;

  let recommendation = "OK";
  let recommendedOrderQty = 0;

  if (annualDemand <= 0) {
    recommendation = "Aucune demande détectée";
  } else if (shortage > 0) {
    recommendation = "Commander immédiatement";
    recommendedOrderQty = Math.max(maxQuantity - effectiveStock, moq, shortage);
  } else if (effectiveStock <= reorderPoint) {
    recommendation = "Réapprovisionner";
    recommendedOrderQty = Math.max(eoq, moq);
  } else if (isOverstock) {
    recommendation = "Surstock à réduire";
  }

  if (isImmature) recommendation = `${recommendation} · SKU immature`;
  if (isVolatile) recommendation = `${recommendation} · Volatilité élevée`;
  if (isSeasonal) recommendation = `${recommendation} · Saisonnalité`;

  return {
    skuId: sku.id,
    skuCode: sku.skuCode,
    annualHistory,
    annualRecent,
    annualDemand,
    dailyDemand,
    coverageTargetDays,
    safetyStock,
    reorderPoint,
    maxQuantity,
    effectiveStock,
    currentCoverageDays,
    volatility,
    isSeasonal,
    isImmature,
    isVolatile,
    recommendedOrderQty,
    recommendation,
  };
}

export function weeklyRecalculation(
  skus: InventorySku[],
  config: InventoryConfig = DEFAULT_CONFIG,
): InventoryResult[] {
  return skus.map((sku) => calculateDynamicInventory(sku, config));
}
