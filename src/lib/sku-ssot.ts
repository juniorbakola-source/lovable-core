/**
 * SKU SSOT (Single Source of Truth) service
 *
 * All SKU mutations flow through this module so that:
 *  - Validation and normalisation are applied consistently
 *  - Every write is accompanied by a change-history record
 *  - Every batch import is accompanied by an import-log record
 *
 * Priority order for conflict resolution: manual > csv/elka > connector
 * (all sources use upsert with the same priority; provenance is stored in
 *  sku_change_history for auditability)
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SourceType = "csv" | "manual" | "connector" | "elka" | "ai" | "system";

export interface SkuPayload {
  sku_code: string;
  name: string;
  category?: string | null;
  stock?: number;
  on_order?: number;
  in_production?: number;
  lead_time_days?: number;
  moq?: number;
  unit_cost?: number;
  service_level?: number;
  demand_history?: number[];
  demand_history_yearly?: number[];
  forecast_3m?: number[];
  min_stock?: number | null;
  max_stock?: number | null;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface UpsertResult {
  sku_code: string;
  status: "inserted" | "updated" | "failed";
  error?: string;
}

export interface ImportResult {
  submitted: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: { sku_code: string; message: string }[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a single SKU payload. Returns an array of errors (empty = valid).
 */
export function validateSku(sku: SkuPayload): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!sku.sku_code || sku.sku_code.trim() === "") {
    errors.push({ field: "sku_code", message: "SKU code is required" });
  }
  if (!sku.name || sku.name.trim() === "") {
    errors.push({ field: "name", message: "Name is required" });
  }
  if (sku.stock !== undefined && sku.stock < 0) {
    errors.push({ field: "stock", message: "Stock must be >= 0" });
  }
  if (sku.on_order !== undefined && sku.on_order < 0) {
    errors.push({ field: "on_order", message: "On order must be >= 0" });
  }
  if (sku.in_production !== undefined && sku.in_production < 0) {
    errors.push({ field: "in_production", message: "In production must be >= 0" });
  }
  if (sku.lead_time_days !== undefined && sku.lead_time_days <= 0) {
    errors.push({ field: "lead_time_days", message: "Lead time must be > 0" });
  }
  if (sku.moq !== undefined && sku.moq < 0) {
    errors.push({ field: "moq", message: "MOQ must be >= 0" });
  }
  if (sku.unit_cost !== undefined && sku.unit_cost < 0) {
    errors.push({ field: "unit_cost", message: "Unit cost must be >= 0" });
  }
  if (sku.service_level !== undefined && (sku.service_level <= 0 || sku.service_level >= 1)) {
    errors.push({
      field: "service_level",
      message: "Service level must be between 0 and 1 (exclusive)",
    });
  }
  if (
    sku.min_stock !== undefined &&
    sku.max_stock !== undefined &&
    sku.min_stock !== null &&
    sku.max_stock !== null &&
    sku.min_stock > sku.max_stock
  ) {
    errors.push({ field: "min_stock", message: "Min stock must be <= max stock" });
  }

  return errors;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalize a SKU payload: trim strings, clamp numerics, etc.
 */
export function normalizeSku(sku: SkuPayload): SkuPayload {
  return {
    ...sku,
    sku_code: sku.sku_code.trim().toUpperCase(),
    name: sku.name.trim(),
    category: sku.category?.trim() || null,
    stock: Math.max(0, Math.round(sku.stock ?? 0)),
    on_order: Math.max(0, Math.round(sku.on_order ?? 0)),
    in_production: Math.max(0, Math.round(sku.in_production ?? 0)),
    lead_time_days: Math.max(1, Math.round(sku.lead_time_days ?? 7)),
    moq: Math.max(1, Math.round(sku.moq ?? 1)),
    unit_cost: Math.max(0, sku.unit_cost ?? 0),
    service_level: Math.min(0.999, Math.max(0.001, sku.service_level ?? 0.95)),
    demand_history: (sku.demand_history ?? []).map((n) => Math.max(0, n)),
    demand_history_yearly: (sku.demand_history_yearly ?? []).map((n) => Math.max(0, n)),
    forecast_3m: (sku.forecast_3m ?? []).map((n) => Math.max(0, n)),
  };
}

// ─── Upsert (single or batch) ────────────────────────────────────────────────

/**
 * Upsert a batch of SKUs into Supabase, record change history and write an
 * import log entry.
 *
 * Uses onConflict: 'user_id,sku_code' so that re-imports update existing rows.
 */
export async function upsertSkus(
  userId: string,
  rawSkus: SkuPayload[],
  sourceType: SourceType,
  opts?: { connectorId?: string; fileName?: string },
): Promise<ImportResult> {
  const errors: ImportResult["errors"] = [];
  const valid: (SkuPayload & { user_id: string })[] = [];

  for (const raw of rawSkus) {
    const errs = validateSku(raw);
    if (errs.length) {
      errors.push({
        sku_code: raw.sku_code ?? "(unknown)",
        message: errs.map((e) => e.message).join("; "),
      });
      continue;
    }
    const normalized = normalizeSku(raw);
    valid.push({ ...normalized, user_id: userId });
  }

  let inserted = 0;
  let updated = 0;

  if (valid.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const chunk = valid.slice(i, i + CHUNK);

      // Fetch existing SKUs to detect insert vs update for history
      const codes = chunk.map((r) => r.sku_code);
      const { data: existing } = await supabase
        .from("skus")
        .select("id, sku_code")
        .eq("user_id", userId)
        .in("sku_code", codes);

      const existingSet = new Set((existing ?? []).map((e) => e.sku_code));

      const { error: upsertErr } = await supabase
        .from("skus")
        .upsert(chunk, { onConflict: "user_id,sku_code" });

      if (upsertErr) {
        for (const row of chunk) {
          errors.push({ sku_code: row.sku_code, message: upsertErr.message });
        }
        continue;
      }

      // Write change history
      const { data: upserted } = await supabase
        .from("skus")
        .select("id, sku_code")
        .eq("user_id", userId)
        .in("sku_code", codes);

      const idByCode = new Map((upserted ?? []).map((r) => [r.sku_code, r.id]));

      const historyRows = chunk
        .map((row) => ({
          sku_id: idByCode.get(row.sku_code) ?? "",
          user_id: userId,
          source_type: sourceType,
          operation: existingSet.has(row.sku_code) ? ("update" as const) : ("insert" as const),
          after_data: row as unknown as Record<string, unknown>,
        }))
        .filter((r) => r.sku_id !== "");

      if (historyRows.length > 0) {
        await supabase.from("sku_change_history").insert(historyRows);
      }

      const chunkInserted = chunk.filter((r) => !existingSet.has(r.sku_code)).length;
      const chunkUpdated = chunk.filter((r) => existingSet.has(r.sku_code)).length;
      inserted += chunkInserted;
      updated += chunkUpdated;
    }
  }

  // Write import log
  await supabase.from("sku_import_logs").insert({
    user_id: userId,
    source_type: sourceType,
    connector_id: opts?.connectorId ?? null,
    file_name: opts?.fileName ?? null,
    rows_submitted: rawSkus.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_failed: errors.length,
    errors: errors.length ? (errors as unknown as import("@/integrations/supabase/types").Json) : null,
    status: errors.length === rawSkus.length ? "failed" : errors.length > 0 ? "partial" : "success",
  });

  return { submitted: rawSkus.length, inserted, updated, failed: errors.length, errors };
}
