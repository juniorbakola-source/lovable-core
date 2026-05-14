"""
=============================================================================
  INVENTORY OPTIMIZER — EOQ / Min / Max Engine
  Author  : Supply Chain Analytics Script
  Version : 1.1.0
  Python  : 3.9+
=============================================================================

METHODOLOGY
-----------
1. DEMAND ANALYSIS
   - Annualised demand  D  = historical 1-year consumption
   - Recent demand          = 3-month forecast/consumption × 4
   - Monthly demand     Dm = annualised demand / 12
   - Daily demand       d  = D / business_days_per_year [default 260]
   - Seasonality flag       when |recent annualised - yearly| / yearly > threshold

2. ECONOMIC ORDER QUANTITY (EOQ) — Wilson / Harris model
   EOQ = sqrt( 2 * D * S / H )
     S  = ordering cost per order   [configurable, default 50 CAD]
     H  = holding cost per unit/yr  = holding_rate × unit cost
                                      [holding_rate default 25%]

3. SAFETY STOCK
   SS = Z × σ_demand × sqrt(lead_time_business_days)
     Z          = service-level z-score   [default 1.65 → 95%]
     σ_demand   = std dev of daily demand (estimated from 3m vs 12m spread)
     lead_time  = per-SKU lead_time_days when available, otherwise global default

4. REORDER POINT (= MIN)
   ROP = (d × lead_time_business_days) + SS

5. MAX
   MAX = ROP + EOQ

6. EFFECTIVE AVAILABLE STOCK
   Effective = available + pipeline/on_order + in_production
   → used to detect live shortage / overstock vs computed thresholds

INPUTS (CSV columns, case-insensitive, whitespace-tolerant)
-----------------------------------------------------------
Supported canonical columns:
  sku, stock, reserved, available, pipeline, in_production,
  sku_create_date, last_cost, lead_time_days,
  historical_3m_consumption, historical_1y_consumption

Supported Supabase/export aliases:
  sku_code, reserve, disponible, on_order, Created_at, unit_cost,
  forecast_3m, demand_history_yearly

OUTPUTS
-------
  inventory_report.csv   — per-SKU metrics + recommendations
  inventory_summary.txt  — human-readable digest
  Console table          — quick view

USAGE
-----
  python scripts/inventory_optimizer.py
  python scripts/inventory_optimizer.py --input data.csv
  python scripts/inventory_optimizer.py --input data.csv \
        --ordering-cost 75 --holding-rate 0.28 \
        --lead-time 21 --service-level 0.97 \
        --output-dir ./results
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import re
import sys
import textwrap
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# 1. CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Config:
    """All tunable parameters in one place — change here or via CLI."""

    ordering_cost: float = 50.0
    holding_rate: float = 0.25
    min_holding_cost: float = 0.10

    # Business-day planning assumptions: Monday-Friday, excluding weekends.
    lead_time_days: int = 14
    business_days_per_year: int = 260
    working_days_per_month: float = 260 / 12

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
        nearest = min(self._Z_TABLE.keys(), key=lambda k: abs(k - self.service_level))
        return self._Z_TABLE[nearest]


# ─────────────────────────────────────────────────────────────────────────────
# 2. DATA MODEL + ROBUST CSV NORMALISATION
# ─────────────────────────────────────────────────────────────────────────────

_COLUMN_ALIASES: Dict[str, List[str]] = {
    "sku": ["sku", "sku_code", "item", "item_code", "part", "part_number", "code"],
    "stock": ["stock", "qty_on_hand", "on_hand", "inventory", "quantity_on_hand"],
    "reserved": ["reserved", "reserve", "qty_reserved", "allocated"],
    "available": ["available", "disponible", "qty_available", "free_stock", "free"],
    "pipeline": ["pipeline", "on_order", "on order", "open_po", "po_open", "ordered"],
    "in_production": ["in_production", "inproduction", "in production", "production", "wip"],
    "sku_create_date": [
        "sku_create_date",
        "sku create date",
        "create_date",
        "created",
        "created_at",
        "created at",
        "creation_date",
        "creation date",
    ],
    "last_cost": ["last_cost", "unit_cost", "unit cost", "cost", "last cost", "standard_cost"],
    "hist_3m": [
        "historical_3m_consumption",
        "hist_3m",
        "3m_consumption",
        "historical 3months consumption",
        "hist3m",
        "forecast_3m",
        "forecast 3m",
        "demand_3m",
        "demand 3m",
    ],
    "hist_1y": [
        "historical_1y_consumption",
        "hist_1y",
        "1y_consumption",
        "historical 1-year consumption",
        "hist1y",
        "demand_history_yearly",
        "demand history yearly",
        "yearly_demand",
        "annual_demand",
    ],
    "lead_time_days": ["lead_time_days", "lead time days", "lead_time", "lead time", "lt_days"],
}


def normalise_key(value: str) -> str:
    """Normalize headers so Supabase, Excel and CSV exports map consistently."""
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def parse_number(value: object, default: float = 0.0) -> float:
    """Parse numeric values from common CSV/Excel formats."""
    if value in (None, ""):
        return default
    text = str(value).strip().replace("\u00a0", "")
    if not text:
        return default

    # Support French/Excel decimal commas when no decimal dot is present.
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    # Remove thousands separators after decimal-comma handling.
    text = text.replace(",", "")

    try:
        return float(text)
    except ValueError:
        return default


def parse_date_value(value: object) -> Optional[date]:
    """Parse common date and datetime formats without marking invalid dates as recent."""
    if value in (None, ""):
        return None

    text = str(value).strip()
    if not text:
        return None

    # Excel serial date support. Ignore 0/1-like values and unrealistic serials.
    if re.fullmatch(r"\d+(\.\d+)?", text):
        serial = float(text)
        if serial > 10_000:
            try:
                return datetime.fromordinal(datetime(1899, 12, 30).toordinal() + int(serial)).date()
            except (OverflowError, ValueError):
                return None

    # ISO-like datetimes from Supabase: 2007-06-12 00:00 or 2019-...447000
    iso_candidate = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_candidate).date()
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%m-%d-%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    return None


def get_value(row: dict, canonical_key: str, default: object = None) -> object:
    """Return a row value using canonical key aliases."""
    aliases = {normalise_key(alias) for alias in _COLUMN_ALIASES.get(canonical_key, [canonical_key])}
    for raw_key, value in row.items():
        if normalise_key(raw_key) in aliases:
            return value
    return default


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
    lead_time_days: Optional[int] = None
    date_parse_warning: bool = False

    @classmethod
    def from_dict(cls, row: dict) -> "SKURecord":
        raw_date = get_value(row, "sku_create_date")
        parsed_date = parse_date_value(raw_date)
        date_parse_warning = raw_date not in (None, "") and parsed_date is None

        lead_time = parse_number(get_value(row, "lead_time_days"), default=0.0)

        return cls(
            sku=str(get_value(row, "sku", "")).strip(),
            stock=parse_number(get_value(row, "stock")),
            reserved=parse_number(get_value(row, "reserved")),
            available=parse_number(get_value(row, "available")),
            pipeline=parse_number(get_value(row, "pipeline")),
            in_production=parse_number(get_value(row, "in_production")),
            sku_create_date=parsed_date,
            last_cost=parse_number(get_value(row, "last_cost")),
            hist_3m=parse_number(get_value(row, "hist_3m")),
            hist_1y=parse_number(get_value(row, "hist_1y")),
            lead_time_days=int(round(lead_time)) if lead_time > 0 else None,
            date_parse_warning=date_parse_warning,
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
    lead_time_days: int
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

    def get_lead_time(self, rec: SKURecord) -> int:
        return rec.lead_time_days or self.cfg.lead_time_days

    def estimate_demand(self, rec: SKURecord) -> Tuple[float, float, float, bool, bool]:
        cfg = self.cfg
        age = rec.age_days()

        # Important fix: missing/unparseable dates are NOT treated as recent.
        is_immature = age is not None and 0 <= age < cfg.maturity_days

        annual_from_3m = rec.hist_3m * 4.0
        annual_from_1y = rec.hist_1y

        if annual_from_1y > 0:
            divergence = abs(annual_from_3m - annual_from_1y) / annual_from_1y
        else:
            divergence = 0.0
        is_seasonal = divergence > cfg.seasonality_threshold

        if is_immature and annual_from_1y <= 0:
            annual_demand = annual_from_3m
        elif is_seasonal:
            annual_demand = max(annual_from_3m, annual_from_1y)
        else:
            w3 = 0.30 if not is_immature else 0.60
            w1 = 1.0 - w3
            annual_demand = w3 * annual_from_3m + w1 * annual_from_1y

        annual_demand = max(annual_demand, 0.0)
        monthly_demand = annual_demand / 12.0
        daily_demand = annual_demand / cfg.business_days_per_year

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
        lead_time_days: int,
    ) -> float:
        cfg = self.cfg
        Z = cfg.z_score()

        monthly_3m = hist_3m / 3.0 if hist_3m > 0 else 0.0
        monthly_1y = hist_1y / 12.0 if hist_1y > 0 else 0.0

        if monthly_3m > 0 and monthly_1y > 0:
            sigma_monthly = abs(monthly_3m - monthly_1y) / 2.0
            sigma_daily = sigma_monthly / cfg.working_days_per_month
            sigma_daily = max(sigma_daily, 0.10 * daily_demand)
        elif daily_demand > 0:
            sigma_daily = 0.20 * daily_demand
        else:
            return 0.0

        seasonal_multiplier = 1.25 if is_seasonal else 1.0
        ss = Z * sigma_daily * math.sqrt(lead_time_days) * seasonal_multiplier
        return round(ss, 2)

    def analyse(self, rec: SKURecord) -> SKUResult:
        annual, monthly, daily, is_seasonal, is_immature = self.estimate_demand(rec)
        lead_time_days = self.get_lead_time(rec)
        eoq, holding_cost, ordering_cost = self.compute_eoq(annual, rec.last_cost)
        safety_stock = self.compute_safety_stock(daily, rec.hist_3m, rec.hist_1y, is_seasonal, lead_time_days)
        reorder_point = round(daily * lead_time_days + safety_stock, 2)
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
            lead_time_days=lead_time_days,
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
        if rec.date_parse_warning:
            notes.append("⚠ SKU create date could not be parsed — maturity not applied")
        if rec.last_cost == 0:
            notes.append("⚠ last_cost/unit_cost = 0 — EOQ uses minimum holding cost floor")
        if annual_demand == 0:
            return "NO ACTION — zero demand", 0.0, notes + ["ℹ No recorded consumption"]

        if shortage > 0:
            order_qty = max(eoq, round(max_qty - effective, 2))
            return "🔴 ORDER NOW", order_qty, notes + [f"Stock below ROP by {shortage:.1f} units"]
        if effective <= rop:
            return "🟡 REORDER", eoq, notes + ["Stock at or below reorder point"]
        if overstock > 0:
            notes.append(f"Stock exceeds MAX by {overstock:.1f} units — consider pausing orders")
            return "🟢 OVERSTOCK — HOLD", 0.0, notes
        return "🟢 OK", 0.0, notes


# ─────────────────────────────────────────────────────────────────────────────
# 4. I/O
# ─────────────────────────────────────────────────────────────────────────────

SAMPLE_CSV = """\
sku_code;category;unit_cost;Created_at;stock;reserve;disponible;on_order;in_production;lead_time_days;demand_history_yearly;forecast_3m
08P08437;C;1.1252;2019-11-05 11:02:07.447000;754;6;748;0;0;23;49;16
10.7X40;C;7.8689;1900-01-01 00:00;64;34;30;100;0;44;414;111
16.2X52;B;7.5208;2007-06-12 00:00;180;90;90;175;0;44;1154;362
"""


def detect_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def load_csv(path: Optional[str]) -> List[SKURecord]:
    if path:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            sample = fh.read(4096)
            fh.seek(0)
            reader = csv.DictReader(fh, dialect=detect_dialect(sample))
            return [SKURecord.from_dict(row) for row in reader]

    reader = csv.DictReader(io.StringIO(SAMPLE_CSV), dialect=detect_dialect(SAMPLE_CSV))
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
        "daily_demand_business",
        "lead_time_business_days",
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
        "coverage_business_days",
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
                "daily_demand_business": r.daily_demand,
                "lead_time_business_days": r.lead_time_days,
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
                "coverage_business_days": r.coverage_days,
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
        f"Default Lead Time={cfg.lead_time_days} business days | "
        f"Business Days/Year={cfg.business_days_per_year} | "
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
            lines.append(f"  Demand     : {r.annual_demand:,.0f}/yr  {r.monthly_demand:,.1f}/mo  {r.daily_demand:.2f}/business day")
            lines.append(f"  Lead Time  : {r.lead_time_days} business days")
            lines.append(f"  Stock Pos  : {r.effective_stock:,.0f} units  ({r.coverage_days:.0f} business days coverage)")
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
        f"{'SKU':<14} {'Action':<22} {'OrdQty':>7} {'EOQ':>6} "
        f"{'Min':>7} {'Max':>7} {'SS':>6} {'EffStk':>7} "
        f"{'Cov_bd':>7} {'LT_bd':>6} {'Demand/y':>9}"
    )
    sep = "-" * len(header)
    print("\n" + sep)
    print(header)
    print(sep)
    for r in results:
        action_short = r.action.replace("🔴 ", "").replace("🟡 ", "").replace("🟢 ", "")
        print(
            f"{r.sku:<14} {action_short:<22} {r.order_qty:>7.0f} {r.eoq:>6.0f} "
            f"{r.reorder_point:>7.0f} {r.max_qty:>7.0f} {r.safety_stock:>6.0f} "
            f"{r.effective_stock:>7.0f} {r.coverage_days:>7.0f} {r.lead_time_days:>6} "
            f"{r.annual_demand:>9.0f}"
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
    parser.add_argument("--lead-time", type=int, default=14, help="Default lead time in business days when SKU has no value")
    parser.add_argument("--business-days-per-year", type=int, default=260, help="Working days per year, Monday-Friday default 260")
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
        business_days_per_year=args.business_days_per_year,
        working_days_per_month=args.business_days_per_year / 12,
        service_level=args.service_level,
    )

    print(f"\n{'=' * 60}")
    print("  INVENTORY OPTIMIZER")
    print(f"{'=' * 60}")
    print(f"  Input                : {args.input or '(built-in sample data)'}")
    print(f"  Ordering Cost        : ${cfg.ordering_cost:.2f}")
    print(f"  Holding Rate         : {cfg.holding_rate * 100:.0f}%")
    print(f"  Default Lead Time    : {cfg.lead_time_days} business days")
    print(f"  Business Days/Year   : {cfg.business_days_per_year}")
    print(f"  Service Level        : {cfg.service_level * 100:.0f}%  (Z={cfg.z_score()})")
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
