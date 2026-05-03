# Architecture — Gestion SKUs SSOT

## Overview

**Gestion SKUs** is the **Single Source of Truth (SSOT)** for all SKU data in FlowStockAI.
Every other module (Silvery Engine, Vue Globale, Solveur, What-If…) reads its SKU data
exclusively from the Supabase `skus` table, which is populated and maintained via the
Gestion SKUs tab.

```
┌─────────────────────────────────────────────────────────┐
│                    Gestion SKUs (SSOT)                  │
│                                                         │
│   CSV / ELKA  ──┐                                       │
│   Manual form ──┼──► SKU SSOT Service ──► skus (table) │
│   Connectors  ──┘    (validate, normalize, upsert)      │
│                       │                                 │
│                       ├──► sku_import_logs              │
│                       └──► sku_change_history           │
└─────────────────────────────────────────────────────────┘
          │
          ▼ (read-only)
  ┌───────────────────────────────────────────────────────┐
  │  Silvery Engine   │  Vue Globale  │  Solveur  │ …     │
  └───────────────────────────────────────────────────────┘
```

---

## Data Model

### Core table: `skus`

| Column                  | Type         | Description                               |
| ----------------------- | ------------ | ----------------------------------------- |
| `id`                    | uuid PK      | Row identifier                            |
| `user_id`               | uuid FK      | Owner (RLS)                               |
| `sku_code`              | text         | Unique per user — normalised to UPPERCASE |
| `name`                  | text         | Product name                              |
| `category`              | text?        | Product category                          |
| `stock`                 | numeric      | Current stock on-hand                     |
| `on_order`              | numeric      | Qty currently on order (in transit)       |
| `in_production`         | numeric      | Qty being manufactured                    |
| `lead_time_days`        | int          | Supplier lead time in days                |
| `moq`                   | int          | Minimum order quantity                    |
| `unit_cost`             | numeric      | Purchase cost per unit                    |
| `service_level`         | numeric      | Target service level (0–1)                |
| `demand_history`        | numeric[]    | 30-day daily demand history               |
| `demand_history_yearly` | numeric[]    | 12-month monthly totals                   |
| `forecast_3m`           | numeric[]    | 3-month forward forecast (monthly)        |
| `min_stock`             | int?         | Manual min stock override                 |
| `max_stock`             | int?         | Manual max stock override                 |
| `ai_min_recommended`    | int?         | AI-optimised min                          |
| `ai_max_recommended`    | int?         | AI-optimised max                          |
| `ai_justification`      | text?        | AI explanation                            |
| `ai_optimized_at`       | timestamptz? | Last AI run                               |

**Unique constraint**: `(user_id, sku_code)` — enables safe upserts.

### `sku_import_logs`

Tracks every import operation (CSV, manual, connector, ELKA).

| Column                                   | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `source_type`                            | `'csv' \| 'manual' \| 'connector' \| 'elka'` |
| `connector_id`                           | FK to `connectors` (if applicable)           |
| `file_name`                              | Original file name                           |
| `rows_submitted/inserted/updated/failed` | Import statistics                            |
| `errors`                                 | JSON array of per-row errors                 |
| `status`                                 | `'success' \| 'partial' \| 'failed'`         |

### `sku_change_history`

Full audit log of every SKU mutation.

| Column        | Description                        |
| ------------- | ---------------------------------- |
| `sku_id`      | FK to `skus`                       |
| `source_type` | Import source                      |
| `operation`   | `'insert' \| 'update' \| 'delete'` |
| `before_data` | JSON snapshot before change        |
| `after_data`  | JSON snapshot after change         |

### `silvery_engine_runs` / `silvery_engine_results`

Results of Silvery Engine computations, persisted for audit and trend analysis.

### `connectors`

External data source configurations (HTTP API, future: SQL, ERP).

---

## Import Pipeline

All data writes go through `src/lib/sku-ssot.ts`:

```
raw input
    │
    ▼ validateSku()       — required fields, numeric ranges, min ≤ max
    │
    ▼ normalizeSku()      — trim/uppercase sku_code, clamp numerics
    │
    ▼ supabase.upsert()   — onConflict: user_id, sku_code
    │
    ├──► sku_change_history (insert / update record)
    └──► sku_import_logs   (batch summary)
```

**Conflict resolution**: upsert always overwrites — provenance is recorded in
`sku_change_history.source_type`. Priority in case of conflicts:
`manual > csv/elka > connector` (manual edits are always explicit).

---

## Silvery Engine Calculations

File: `src/lib/silvery-engine.ts`

| Output                | Formula                                                        |
| --------------------- | -------------------------------------------------------------- |
| **Safety Stock**      | `z × σ × √(lead_time)` (z from service level)                  |
| **Reorder Point**     | `avg_daily_demand × lead_time + safety_stock`                  |
| **EOQ**               | `√(2 × D × S / (H × C))` (Wilson formula)                      |
| **Min optimised**     | `= reorder_point`                                              |
| **Max optimised**     | `min + max(EOQ, MOQ)` rounded to MOQ                           |
| **Recommended order** | `max_opt - projected_inventory` if below ROP                   |
| **Break-even qty**    | `ordering_cost / unit_margin`                                  |
| **Status**            | `critical / low / ok / overstock` based on stock vs SS/ROP/90d |

> **TODOs**: source `orderingCost` and `margin` from a settings table;
> integrate actual selling price when a product catalogue is available.

---

## Connectors — Adding a New Connector

1. Create `src/lib/connectors/my-connector.ts`
2. Implement the `Connector` interface from `src/lib/connectors/types.ts`:
   ```typescript
   export const myConnector: Connector = {
     type: "my_system",
     label: "My System",
     description: "Imports from XYZ",
     async fetch(config) {
       /* ... */
     },
     map(rows, mappings) {
       /* ... */
     },
   };
   ```
3. Register it in the Connectors UI (`dashboard.connectors.tsx`) so users can
   select it from the connector type dropdown.
4. Add the new type to the `connector_type` CHECK constraint in a new migration.

**Field mappings** map external field names → internal SKU field names:

```json
{ "item_code": "sku_code", "description": "name", "qty_on_hand": "stock" }
```

Stored in `connectors.field_mappings` (jsonb).

---

## Scheduled Engine Runs

The Silvery Engine can be triggered:

1. **Manually** from the Silvery Engine tab in the dashboard.
2. **Weekly** via GitHub Actions (`.github/workflows/silvery-engine-weekly.yml`).

To enable automated runs, add these repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SILVERY_ENGINE_USER_ID`

The workflow calls the `silvery-engine-run` Supabase Edge Function
(TODO: implement at `supabase/functions/silvery-engine-run/index.ts`).

---

## Security

- All tables use **Row Level Security (RLS)** — users only access their own data.
- The `sku_change_history` write uses the authenticated user's JWT; no elevated
  permissions are required.
- Connector configs (including API keys) are stored in `connectors.config` (jsonb)
  which is protected by RLS. **Do not expose this data to the frontend** beyond
  the owning user's session.

---

## Orphan SKU Cleanup

**Orphan SKUs** are rows in `public.skus` where `user_id IS NULL`. They are
permanently invisible to every authenticated user (all RLS policies require
`auth.uid() = user_id`) and accumulate silently.

### Audit view: `public.v_orphan_skus`

A read-only view that lists all SKU rows without an owner:

```sql
SELECT * FROM public.v_orphan_skus;         -- inspect orphans
SELECT count(*) FROM public.v_orphan_skus;  -- count orphans
```

### Cleanup function: `public.purge_orphan_skus()`

A `SECURITY DEFINER` function (migration
`supabase/migrations/20260503002000_orphan_skus_cleanup.sql`) that deletes
every orphan row and returns the number of rows removed.

```sql
-- Must be called by a service-role or super-admin:
SELECT public.purge_orphan_skus();
```

- **Not triggered automatically** — call it explicitly after auditing with
  `v_orphan_skus`.
- Writes one summary row to `sku_change_history` when rows are deleted.
- Touches **only** rows where `user_id IS NULL`; tenant data is never affected.
