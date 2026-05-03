/**
 * HTTP API Connector — fetches SKU data from a generic HTTP endpoint.
 *
 * Supports:
 *  - GET / POST
 *  - Custom headers (e.g., Authorization: Bearer <token>)
 *  - Response unwrapping via responseRootKey (e.g., "data.items")
 *  - Field mapping via the standard FieldMappings mechanism
 *
 * TODO: Add OAuth2 / API-key rotation support for production use.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorFetchResult,
  ConnectorMapResult,
  FieldMappings,
  HttpConnectorConfig,
} from "./types";
import { applyFieldMappings } from "./types";
import type { SkuPayload } from "@/lib/sku-ssot";

function dig(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      obj,
    );
}

export const httpConnector: Connector = {
  type: "http_api",
  label: "API HTTP Générique",
  description:
    "Importe les SKUs depuis n'importe quel endpoint REST/JSON. Configurez l'URL, les headers et le mapping de champs.",

  async fetch(config: ConnectorConfig): Promise<ConnectorFetchResult> {
    const c = config as HttpConnectorConfig;
    if (!c.url) {
      return { rawRows: [], error: "URL is required" };
    }

    try {
      const resp = await fetch(c.url, {
        method: c.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(c.headers ?? {}),
        },
        body: c.method === "POST" && c.body ? c.body : undefined,
      });

      if (!resp.ok) {
        return {
          rawRows: [],
          error: `HTTP ${resp.status}: ${resp.statusText}`,
        };
      }

      const json: unknown = await resp.json();
      let rows: unknown = json;

      if (c.responseRootKey) {
        rows = dig(json, c.responseRootKey);
      }

      if (!Array.isArray(rows)) {
        return {
          rawRows: [],
          error: `Expected an array${c.responseRootKey ? ` at "${c.responseRootKey}"` : ""}, got ${typeof rows}`,
        };
      }

      return {
        rawRows: rows as Record<string, unknown>[],
      };
    } catch (e) {
      return {
        rawRows: [],
        error: (e as Error).message,
      };
    }
  },

  map(rows: Record<string, unknown>[], mappings: FieldMappings): ConnectorMapResult {
    const skus: SkuPayload[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const partial = applyFieldMappings(rows[i], mappings);
      if (!partial.sku_code) {
        warnings.push(`Row ${i}: missing sku_code after mapping — skipped`);
        continue;
      }
      if (!partial.name) {
        // Fall back to sku_code as name if not mapped
        partial.name = partial.sku_code;
      }
      skus.push(partial as SkuPayload);
    }

    return { skus, warnings };
  },
};
