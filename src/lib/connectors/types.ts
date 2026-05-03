/**
 * Connector interface — all external data source connectors implement this.
 *
 * To add a new connector:
 *  1. Create a new file in src/lib/connectors/ (e.g., sql.ts)
 *  2. Implement the Connector interface
 *  3. Register it in the CONNECTOR_REGISTRY in registry.ts
 */

import type { SkuPayload } from "@/lib/sku-ssot";

// ─── Field mapping ────────────────────────────────────────────────────────────

/**
 * Maps external field names → internal SKU field names.
 * Example: { "item_code": "sku_code", "description": "name", "qty_on_hand": "stock" }
 */
export type FieldMappings = Record<string, keyof SkuPayload | string>;

// ─── Connector config ─────────────────────────────────────────────────────────

/** Configuration stored in Supabase connectors.config column */
export interface ConnectorConfig {
  [key: string]: unknown;
}

export interface HttpConnectorConfig extends ConnectorConfig {
  /** Full URL to fetch SKU data from */
  url: string;
  /** HTTP method (default: GET) */
  method?: "GET" | "POST";
  /** Optional headers (e.g., Authorization) */
  headers?: Record<string, string>;
  /** Optional request body for POST */
  body?: string;
  /**
   * JSONPath-like root key to extract the rows array from the response.
   * E.g. "data.items" → response.data.items
   * Leave empty if the root of the response is the array.
   */
  responseRootKey?: string;
}

// ─── Connector interface ──────────────────────────────────────────────────────

export interface ConnectorFetchResult {
  /** Raw rows fetched from the external source (before mapping) */
  rawRows: Record<string, unknown>[];
  /** Any fetch-level error */
  error?: string;
}

export interface ConnectorMapResult {
  /** Mapped SKU payloads (after applying field_mappings) */
  skus: SkuPayload[];
  /** Per-row mapping warnings */
  warnings: string[];
}

export interface Connector {
  /** Unique machine identifier for this connector type */
  readonly type: string;
  /** Human-readable display name */
  readonly label: string;
  /** Short description shown in UI */
  readonly description: string;

  /**
   * Fetch raw rows from the external source.
   */
  fetch(config: ConnectorConfig): Promise<ConnectorFetchResult>;

  /**
   * Map raw rows to SkuPayload[] using the provided field mappings.
   */
  map(rows: Record<string, unknown>[], mappings: FieldMappings): ConnectorMapResult;
}

// ─── Field mapping helper ─────────────────────────────────────────────────────

/** SKU fields that can be mapped from an external source */
export const SKU_TARGET_FIELDS: Array<keyof SkuPayload> = [
  "sku_code",
  "name",
  "category",
  "stock",
  "on_order",
  "in_production",
  "lead_time_days",
  "moq",
  "unit_cost",
  "service_level",
];

/**
 * Apply field mappings to a single raw row, returning a partial SkuPayload.
 * Numeric fields are coerced. Unknown target fields are ignored.
 */
export function applyFieldMappings(
  row: Record<string, unknown>,
  mappings: FieldMappings,
): Partial<SkuPayload> {
  const result: Partial<SkuPayload> = {};
  const numericFields: Array<keyof SkuPayload> = [
    "stock",
    "on_order",
    "in_production",
    "lead_time_days",
    "moq",
    "unit_cost",
    "service_level",
  ];

  for (const [sourceKey, targetKey] of Object.entries(mappings)) {
    const value = row[sourceKey];
    if (value === undefined || value === null) continue;
    const target = targetKey as keyof SkuPayload;
    if (!SKU_TARGET_FIELDS.includes(target)) continue;

    if (numericFields.includes(target)) {
      const n = Number(value);
      if (!isNaN(n)) (result as Record<string, unknown>)[target] = n;
    } else {
      (result as Record<string, unknown>)[target] = String(value).trim();
    }
  }

  return result;
}
