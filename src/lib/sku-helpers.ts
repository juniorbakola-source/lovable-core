import type { Database } from "@/integrations/supabase/types";
import type { SkuInput } from "./optimizer";

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

/** Convert a nullable Supabase SKU row into a safe SkuInput with defaults */
export function toSkuInput(s: SkuRow): SkuInput {
  return {
    stock: s.stock ?? 0,
    on_order: s.on_order ?? 0,
    in_production: s.in_production ?? 0,
    lead_time_days: s.lead_time_days ?? 7,
    moq: s.moq ?? 1,
    unit_cost: s.unit_cost ?? 0,
    service_level: s.service_level ?? 0.95,
    demand_history: s.demand_history ?? [],
    demand_history_yearly: s.demand_history_yearly ?? [],
    forecast_3m: s.forecast_3m ?? [],
  };
}

/** Safe accessors for commonly used nullable fields */
export function safeNum(v: number | null | undefined, fallback = 0): number {
  return v ?? fallback;
}

export function safeStr(v: string | null | undefined, fallback = ""): string {
  return v ?? fallback;
}
