"""
=============================================================================
  INVENTORY OPTIMIZER — EOQ / Min / Max Engine
  Author  : Supply Chain Analytics Script
  Version : 1.0.0
  Python  : 3.9+
=============================================================================

METHODOLOGY
-----------
1. DEMAND ANALYSIS
   - Annualised demand  D  = historical 1-year consumption
   - Monthly demand     Dm = 3-month consumption / 3
   - Daily demand       d  = D / 365
   - Seasonality flag       when |Dm*12 - D| / D > threshold

2. ECONOMIC ORDER QUANTITY (EOQ) — Wilson / Harris model
   EOQ = sqrt( 2 * D * S / H )
     S  = ordering cost per order   [configurable, default 50 CAD]
     H  = holding cost per unit/yr  = holding_rate × last_cost
                                      [holding_rate default 25%]

3. SAFETY STOCK
   SS = Z × σ_demand × sqrt(lead_time_days)
     Z          = service-level z-score   [default 1.65 → 95%]
     σ_demand   = std dev of daily demand (estimated from 3m vs 12m spread)
     lead_time  = configurable per SKU or global default [default 14 days]

4. REORDER POINT (= MIN)
   ROP = (d × lead_time_days) + SS

5. MAX
   MAX = ROP + EOQ

6. EFFECTIVE AVAILABLE STOCK
   Effective = available + pipeline + in_production
   → used to detect live shortage / overstock vs computed thresholds

INPUTS (CSV columns, case-insensitive, whitespace-tolerant)
-----------------------------------------------------------
  sku, stock, reserved, available, pipeline, in_production,
  sku_create_date, last_cost,
  historical_3m_consumption, historical_1y_consumption

OUTPUTS
-------
  inventory_report.csv   — per-SKU metrics + recommendations
  inventory_summary.txt  — human-readable digest
  Console table          — quick view

USAGE
-----
  python inventory_optimizer.py                          # uses sample data
  python inventory_optimizer.py --input data.csv
  python inventory_optimizer.py --input data.csv \
        --ordering-cost 75 --holding-rate 0.28 \
        --lead-time 21    --service-level 0.97 \
        --output-dir ./results
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import sys
import textwrap
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# 1. CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Config:
    """All tunable parameters in one place — change here or via CLI."""

    ordering_cost: float = 50.0
    holding_rate: float = 0.25
    min_holding_cost: float = 0.10
    lead_time_days: int = 14
    service_level: float = 0.95
    _Z_TABLE: dict = field(default_factory=lambda: {
        0.80: 0.842,
        0.85: 1.036,
        0.90: 1.282,
        0.95: 1.645,
        0.97: 1.881,
        0.99: 2.326,
    })
    eoq_min_qty: int = 1
    eoq_max_multiple: float = 12.0
    seasonality_threshold: float = 0.20
    maturity_days: int = 365

    def z_score(self) -> float:
        table = self._Z_TABLE
        nearest = min(table.keys(), key=lambda k: abs(k - self.service_level))
        return table[nearest]


# ─────────────────────────────────────────────────────────────────────────────
# 2. DATA MODEL
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SKURecord:
    """Raw input row, normalised."""

    sku: str
    stock: float
    reserved: float
    available: float
    pipeline: float
    in_production: float
    sku_create_date: Optional[date]
    last_cost: float
    hist_3m: float
    hist_1y: float

    @classmethod
    def from_dict(cls, row: dict) -> "SKURecord":
        def normalise_key(value: str) -> str:
            return value.strip().lower().replace(" ", "_").replace("-", "_")

        def f(key: str, default: float = 0.0) -> float:
            aliases = {
                "in_production": ["in_production", "inproduction", "in production", "production"],
                "hist_3m": [
                    "historical_3m_consumption",
                    "hist_3m",
                    "3m_consumption",
                    "historical 3months consumption",
                    "hist3m",
                ],
                "hist_1y": [
                    "historical_1y_consumption",
                    "hist_1y",
                    "1y_consumption",
                    "historical 1-year consumption",
                    "hist1y",
                ],
                "sku_create_date": ["sku_create_date", "create_date", "sku create date", "created"],
            }
            search_keys = [normalise_key(candidate) for candidate in aliases.get(key, [key])]
            for k, v in row.items():
                if normalise_key(k) in search_keys:
                    try:
                        return float(v) if v not in ("", None) else default
                    except ValueError:
                        return default
            return default

        def parse_date(row: dict) -> Optional[date]:
            date_keys = {normalise_key(k) for k in ["sku_create_date", "sku create date", "create_date", "created"]}
            for k, v in row.items():
                if normalise_key(k) in date_keys and v not in ("", None):
                    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y"):
                        try:
                            return datetime.strptime(str(v).strip(), fmt).date()
                        except ValueError:
                            continue
            return None

        def simple(key: str, default: float = 0.0) -> float:
            for k, v in row.items():
                if normalise_key(k) == key:
                    try:
                        return float(v) if v not in ("", None) else default
                    except ValueError:
                        return default
            return default

        sku_val = ""
        for k, v in row.items():
            if normalise_key(k) == "sku":
                sku_val = str(v).strip()
                break

        return cls(
            sku=sku_val,
            stock=simple("stock"),
            reserved=simple("reserved"),
            available=simple("available"),
            pipeline=simple("pipeline"),
            in_production=f("in_production"),
            sku_create_date=parse_date(row),
            last_cost=simple("last_cost"),
            hist_3m=f("hist_3m"),
            hist_1y=f("hist_1y"),
        )

    def age_days(self) -> Optional[int]:
        if self.sku_create_date:
            return (date.today() - self.sku_create_date).days
        return None


@dataclass
class SKUResult:
    """Computed metrics for a single SKU."""

    sku: str
    annual_demand: float
    monthly_demand: float
    daily_demand: float
    is_seasonal: bool
    is_immature: bool
    last_cost: float
    holding_cost_per_unit: float
    ordering_cost: float
    eoq: float
    safety_stock: float
    reorder_point: float
    max_qty: float
    effective_stock: float
    coverage_days: float
    shortage: float
    overstock: float
    action: str
    order_qty: float
    notes: List[str]


# ─────────────────────────────────────────────────────────────────────────────
# 3. CORE CALCULATIONS
# ─────────────────────────────────────────────────────────────────────────────

class InventoryCalculator:
    def __init__(self, config: Config):
        self.cfg = config

    def estimate_demand(self, rec: SKURecord) -> Tuple[float, float, float, bool, bool]:
        cfg = self.cfg
        age = rec.age_days()
        is_immature = age is not None and age < cfg.maturity_days

        annual_from_3m = rec.hist_3m * 4.0
        annual_from_1y = rec.hist_1y

        if annual_from_1y > 0:
            divergence = abs(annual_from_3m - annual_from_1y) / annual_from_1y
        else:
            divergence = 0.0
        is_seasonal = divergence > cfg.seasonality_threshold

        if is_immature and rec.hist_1y <= 0:
            annual_demand = annual_from_3m
        elif is_seasonal:
            annual_demand = max(annual_from_3m, annual_from_1y)
        else:
            w3 = 0.30 if not is_immature else 0.60
            w1 = 1.0 - w3
            annual_demand = w3 * annual_from_3m + w1 * annual_from_1y

        annual_demand = max(annual_demand, 0.0)
        monthly_demand = annual_demand / 12.0
        daily_demand = annual_demand / 365.0

        return annual_demand, monthly_demand, daily_demand, is_seasonal, is_immature

    def compute_eoq(self, annual_demand: float, last_cost: float) -> Tuple[float, float, float]:
        cfg = self.cfg
        S = cfg.ordering_cost
        H = max(cfg.holding_rate * last_cost, cfg.min_holding_cost)

        if annual_demand <= 0 or S <= 0 or H <= 0:
            return 0.0, H, S

        eoq_raw = math.sqrt((2.0 * annual_demand * S) / H)
        max_eoq = (annual_demand / 12.0) * cfg.eoq_max_multiple
        eoq = min(eoq_raw, max_eoq)
        eoq = max(round(eoq), cfg.eoq_min_qty)

        return float(eoq), H, S

    def compute_safety_stock(
        self,
        daily_demand: float,
        hist_3m: float,
        hist_1y: float,
        is_seasonal: bool,
    ) -> float:
        cfg = self.cfg
        Z = cfg.z_score()
        LT = cfg.lead_time_days

        monthly_3m = hist_3m / 3.0 if hist_3m > 0 else 0.0
        monthly_1y = hist_1y / 12.0 if hist_1y > 0 else 0.0

        if monthly_3m > 0 and monthly_1y > 0:
            sigma_monthly = abs(monthly_3m - monthly_1y) / 2.0
            sigma_daily = sigma_monthly / 30.0
            sigma_daily = max(sigma_daily, 0.10 * daily_demand)
        elif daily_demand > 0:
            sigma_daily = 0.20 * daily_demand
        else:
            return 0.0

        seasonal_multiplier = 1.25 if is_seasonal else 1.0
        ss = Z * sigma_daily * math.sqrt(LT) * seasonal_multiplier
        return round(ss, 2)

    def analyse(self, rec: SKURecord) -> SKUResult:
        cfg = self.cfg
        annual, monthly, daily, is_seasonal, is_immature = self.estimate_demand(rec)
        eoq, holding_cost, ordering_cost = self.compute_eoq(annual, rec.last_cost)
        safety_stock = self.compute_safety_stock(daily, rec.hist_3m, rec.hist_1y, is_seasonal)
        reorder_point = round(daily * cfg.lead_time_days + safety_stock, 2)
        max_qty = round(reorder_point + eoq, 2)

        effective = rec.available + rec.pipeline + rec.in_production
        coverage = (effective / daily) if daily > 0 else float("inf")
        shortage = max(0.0, reorder_point - effective)
        overstock = max(0.0, effective - max_qty)

        action, order_qty, notes = self._recommend(
            rec,
            effective,
            reorder_point,
            max_qty,
            eoq,
            shortage,
            overstock,
            annual,
            is_seasonal,
            is_immature,
        )

        return SKUResult(
            sku=rec.sku,
            annual_demand=round(annual, 2),
            monthly_demand=round(monthly, 2),
            daily_demand=round(daily, 4),
            is_seasonal=is_seasonal,
            is_immature=is_immature,
            last_cost=rec.last_cost,
            holding_cost_per_unit=round(holding_cost, 4),
            ordering_cost=ordering_cost,
            eoq=eoq,
            safety_stock=round(safety_stock, 2),
            reorder_point=reorder_point,
            max_qty=max_qty,
            effective_stock=round(effective, 2),
            coverage_days=round(coverage, 1) if coverage != float("inf") else 9999,
            shortage=round(shortage, 2),
            overstock=round(overstock, 2),
            action=action,
            order_qty=round(order_qty, 2),
            notes=notes,
        )

    def _recommend(
        self,
        rec: SKURecord,
        effective: float,
        rop: float,
        max_qty: float,
        eoq: float,
        shortage: float,
        overstock: float,
        annual_demand: float,
        is_seasonal: bool,
        is_immature: bool,
    ) -> Tuple[str, float, List[str]]:
        notes: List[str] = []
        if is_seasonal:
            notes.append("⚠ Seasonal demand detected — review min/max quarterly")
        if is_immature:
            notes.append("⚠ SKU has < 1 year history — parameters will improve over time")
        if rec.last_cost == 0:
            notes.append("⚠ last_cost = 0 — EOQ uses minimum holding cost floor")
        if annual_demand == 0:
            return "NO ACTION — zero demand", 0.0, notes + ["ℹ No recorded consumption"]

        if shortage > 0:
            order_qty = max(eoq, round(max_qty - effective, 2))
            return "🔴 ORDER NOW", order_qty, notes + [f"Stock below ROP by {shortage:.1f} units"]
        if effective <= rop:
            order_qty = eoq
            return "🟡 REORDER", order_qty, notes + ["Stock at or below reorder point"]
        if overstock > 0:
            notes.append(f"Stock exceeds MAX by {overstock:.1f} units — consider pausing orders")
            return "🟢 OVERSTOCK — HOLD", 0.0, notes
        return "🟢 OK", 0.0, notes


# ─────────────────────────────────────────────────────────────────────────────
# 4. I/O
# ─────────────────────────────────────────────────────────────────────────────

SAMPLE_CSV = """\
sku,stock,reserved,available,pipeline,in_production,sku_create_date,last_cost,historical_3m_consumption,historical_1y_consumption
SKU-001,500,50,450,100,0,2021-03-15,12.50,300,1100
SKU-002,80,10,70,0,0,2022-07-01,5.00,200,900
SKU-003,20,5,15,0,0,2023-11-20,75.00,60,220
SKU-004,1200,200,1000,0,0,2020-01-10,2.30,80,280
SKU-005,0,0,0,50,30,2024-02-01,150.00,25,0
SKU-006,350,30,320,0,0,2019-06-12,8.75,400,1900
SKU-007,10,0,10,0,0,2023-05-05,0.00,15,55
"""


def load_csv(path: Optional[str]) -> List[SKURecord]:
    if path:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            return [SKURecord.from_dict(row) for row in reader]

    reader = csv.DictReader(io.StringIO(SAMPLE_CSV))
    return [SKURecord.from_dict(row) for row in reader]


def write_csv(results: List[SKUResult], out_path: str) -> None:
    if not results:
        return

    columns = [
        "sku",
        "action",
        "order_qty",
        "annual_demand",
        "monthly_demand",
        "daily_demand",
        "is_seasonal",
        "is_immature",
        "last_cost",
        "holding_cost_per_unit",
        "ordering_cost",
        "eoq",
        "safety_stock",
        "reorder_point",
        "max_qty",
        "effective_stock",
        "coverage_days",
        "shortage",
        "overstock",
        "notes",
    ]
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for r in results:
            writer.writerow({
                "sku": r.sku,
                "action": r.action,
                "order_qty": r.order_qty,
                "annual_demand": r.annual_demand,
                "monthly_demand": r.monthly_demand,
                "daily_demand": r.daily_demand,
                "is_seasonal": r.is_seasonal,
                "is_immature": r.is_immature,
                "last_cost": r.last_cost,
                "holding_cost_per_unit": r.holding_cost_per_unit,
                "ordering_cost": r.ordering_cost,
                "eoq": r.eoq,
                "safety_stock": r.safety_stock,
                "reorder_point": r.reorder_point,
                "max_qty": r.max_qty,
                "effective_stock": r.effective_stock,
                "coverage_days": r.coverage_days,
                "shortage": r.shortage,
                "overstock": r.overstock,
                "notes": " | ".join(r.notes),
            })


def write_summary(results: List[SKUResult], cfg: Config, out_path: str) -> None:
    lines: List[str] = []
    sep = "=" * 72
    lines.append(sep)
    lines.append("  INVENTORY OPTIMIZATION REPORT")
    lines.append(f"  Generated : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(
        f"  Parameters: Ordering Cost=${cfg.ordering_cost:.2f} | "
        f"Holding Rate={cfg.holding_rate * 100:.0f}% | "
        f"Lead Time={cfg.lead_time_days}d | "
        f"Service Level={cfg.service_level * 100:.0f}%"
    )
    lines.append(sep)

    urgent = [r for r in results if "ORDER NOW" in r.action]
    reorder = [r for r in results if "REORDER" in r.action and "ORDER NOW" not in r.action]
    overstocked = [r for r in results if "OVERSTOCK" in r.action]
    ok = [r for r in results if r.action.startswith("🟢 OK")]

    lines.append(f"\n  SUMMARY: {len(results)} SKUs analysed")
    lines.append(f"  🔴 ORDER NOW  : {len(urgent)}")
    lines.append(f"  🟡 REORDER    : {len(reorder)}")
    lines.append(f"  🟢 OVERSTOCK  : {len(overstocked)}")
    lines.append(f"  🟢 OK / HOLD  : {len(ok)}")
    lines.append("")

    for section_label, section in [
        ("🔴 URGENT — ORDER NOW", urgent),
        ("🟡 REORDER RECOMMENDED", reorder),
        ("🟢 OVERSTOCK — HOLD ORDERS", overstocked),
        ("🟢 OK — NO ACTION", ok),
    ]:
        if not section:
            continue
        lines.append(sep)
        lines.append(f"  {section_label}")
        lines.append(sep)
        for r in section:
            lines.append(f"\n  SKU        : {r.sku}")
            lines.append(f"  Action     : {r.action}")
            if r.order_qty > 0:
                lines.append(f"  Order Qty  : {r.order_qty:,.0f} units  (EOQ={r.eoq:,.0f})")
            lines.append(f"  Demand     : {r.annual_demand:,.0f}/yr  {r.monthly_demand:,.1f}/mo  {r.daily_demand:.2f}/day")
            lines.append(f"  Stock Pos  : {r.effective_stock:,.0f} units  ({r.coverage_days:.0f} days coverage)")
            lines.append(f"  MIN (ROP)  : {r.reorder_point:,.0f}   MAX: {r.max_qty:,.0f}   SS: {r.safety_stock:,.0f}")
            for note in r.notes:
                lines.append(f"  Note       : {note}")

    lines.append("\n" + sep)
    lines.append("  END OF REPORT")
    lines.append(sep)

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def print_table(results: List[SKUResult]) -> None:
    """Print a compact aligned table to stdout."""
    header = (
        f"{'SKU':<12} {'Action':<22} {'OrdQty':>7} {'EOQ':>6} "
        f"{'Min':>7} {'Max':>7} {'EffStk':>7} {'Cov_d':>6} "
        f"{'Demand/y':>9}"
    )
    sep = "-" * len(header)
    print("\n" + sep)
    print(header)
    print(sep)
    for r in results:
        action_short = r.action.replace("🔴 ", "").replace("🟡 ", "").replace("🟢 ", "")
        print(
            f"{r.sku:<12} {action_short:<22} {r.order_qty:>7.0f} {r.eoq:>6.0f} "
            f"{r.reorder_point:>7.0f} {r.max_qty:>7.0f} {r.effective_stock:>7.0f} "
            f"{r.coverage_days:>6.0f} {r.annual_demand:>9.0f}"
        )
    print(sep + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# 5. CLI ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=textwrap.dedent("""\
            Inventory Optimizer — EOQ / Min / Max engine
            ─────────────────────────────────────────────
            Reads a CSV of SKU inventory data and outputs
            per-SKU EOQ, Safety Stock, Min (ROP), Max, and
            actionable reorder recommendations.
        """),
    )
    parser.add_argument("--input", default=None, help="Path to input CSV (omit to use built-in sample data)")
    parser.add_argument("--output-dir", default=".", help="Directory for output files (default: current dir)")
    parser.add_argument("--ordering-cost", type=float, default=50.0, help="Cost per order placed ($, default 50)")
    parser.add_argument("--holding-rate", type=float, default=0.25, help="Annual holding rate 0-1 (default 0.25 = 25%%)")
    parser.add_argument("--lead-time", type=int, default=14, help="Lead time in days (default 14)")
    parser.add_argument("--service-level", type=float, default=0.95, help="Service level 0-1 (default 0.95 = 95%%)")
    parser.add_argument("--no-csv", action="store_true", help="Skip writing output CSV")
    parser.add_argument("--no-summary", action="store_true", help="Skip writing summary TXT")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    cfg = Config(
        ordering_cost=args.ordering_cost,
        holding_rate=args.holding_rate,
        lead_time_days=args.lead_time,
        service_level=args.service_level,
    )

    print(f"\n{'=' * 60}")
    print("  INVENTORY OPTIMIZER")
    print(f"{'=' * 60}")
    print(f"  Input          : {args.input or '(built-in sample data)'}")
    print(f"  Ordering Cost  : ${cfg.ordering_cost:.2f}")
    print(f"  Holding Rate   : {cfg.holding_rate * 100:.0f}%")
    print(f"  Lead Time      : {cfg.lead_time_days} days")
    print(f"  Service Level  : {cfg.service_level * 100:.0f}%  (Z={cfg.z_score()})")
    print(f"{'=' * 60}\n")

    records = load_csv(args.input)
    if not records:
        print("ERROR: No records found in input file.")
        sys.exit(1)
    print(f"  Loaded {len(records)} SKU record(s).\n")

    calc = InventoryCalculator(cfg)
    results = [calc.analyse(record) for record in records]

    print_table(results)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not args.no_csv:
        csv_path = str(out_dir / "inventory_report.csv")
        write_csv(results, csv_path)
        print(f"  ✔ CSV report  → {csv_path}")

    if not args.no_summary:
        txt_path = str(out_dir / "inventory_summary.txt")
        write_summary(results, cfg, txt_path)
        print(f"  ✔ TXT summary → {txt_path}")

    print()


if __name__ == "__main__":
    main()
