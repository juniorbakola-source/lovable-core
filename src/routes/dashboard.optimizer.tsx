import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  escapeCsvCell,
  getVolatilityBand,
  type VolatilityBand,
} from "@/lib/hybrid-dashboard-utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Loader2,
  Play,
  RefreshCw,
  Download,
  Search,
  TrendingUp,
  AlertTriangle,
  Boxes,
  Filter,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
  ReferenceLine,
} from "recharts";
import type { Database } from "@/integrations/supabase/types";

type Sku = Pick<
  Database["public"]["Tables"]["skus"]["Row"],
  | "id"
  | "sku_code"
  | "name"
  | "stock"
  | "on_order"
  | "in_production"
  | "lead_time_days"
  | "unit_cost"
  | "demand_history"
  | "demand_history_yearly"
  | "forecast_3m"
  | "created_at"
>;

export const Route = createFileRoute("/dashboard/optimizer")({
  head: () => ({ meta: [{ title: "Inventory Optimizer — FlowStock" }] }),
  component: OptimizerPage,
});

type Cfg = {
  ordering_cost: number;
  holding_rate: number;
  lead_time_days: number;
  service_level: number;
  business_days_per_year: number;
  demand_multiplier: number;
};

const Z_TABLE: Record<string, number> = {
  "0.8": 0.842,
  "0.85": 1.036,
  "0.9": 1.282,
  "0.95": 1.645,
  "0.97": 1.881,
  "0.99": 2.326,
};

const zScore = (serviceLevel: number) => {
  const nearest = Object.keys(Z_TABLE).reduce((a, b) =>
    Math.abs(parseFloat(b) - serviceLevel) < Math.abs(parseFloat(a) - serviceLevel) ? b : a,
  );
  return Z_TABLE[nearest];
};

const safeNum = (value: unknown, fallback = 0) => {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
};

function parseSkuDate(value: string | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  if (year < 1900 || parsed.getTime() > Date.now()) return null;
  return parsed;
}

type ActionKey = "urgent" | "reorder" | "overstock" | "ok" | "none";
type ActionFilter = ActionKey | "all";
type RiskFilter = "all" | "stockout" | "overstock" | "seasonal" | "immature" | "volatile";
type BinaryFilter = "all" | "yes" | "no";
type VolatilityFilter = "all" | VolatilityBand;

type Result = {
  sku_id: string;
  sku: string;
  sku_name: string;
  annual_demand: number;
  monthly_demand: number;
  daily_demand: number;
  lead_time_days: number;
  is_seasonal: boolean;
  is_immature: boolean;
  volatility_ratio: number;
  volatility_band: VolatilityBand;
  eoq: number;
  safety_stock: number;
  reorder_point: number;
  max_qty: number;
  effective_stock: number;
  coverage_days: number;
  shortage: number;
  overstock: number;
  stockout_risk: boolean;
  overstock_risk: boolean;
  action: string;
  actionKey: ActionKey;
  order_qty: number;
  notes: string[];
  stock: number;
  on_order: number;
  in_production: number;
};

type DemandTrendPoint = {
  period: string;
  historical: number | null;
  forecast: number | null;
};

type StockSignalPoint = {
  sku: string;
  effective_stock: number;
  reorder_point: number;
  max_qty: number;
};

function sum(values: number[] | null | undefined) {
  return (values ?? []).reduce((total, value) => total + safeNum(value), 0);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("fr-FR", { month: "short" });
}

function extractChartSku(chartState: unknown): string | null {
  // Recharts click payload shape: { activePayload: [{ payload: { sku: string } }] }
  if (!chartState || typeof chartState !== "object") return null;
  const activePayload = (chartState as { activePayload?: unknown }).activePayload;
  if (!Array.isArray(activePayload) || activePayload.length === 0) return null;

  const first = activePayload[0];
  if (!first || typeof first !== "object") return null;
  const payload = (first as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;

  const sku = (payload as { sku?: unknown }).sku;
  return typeof sku === "string" ? sku : null;
}

function buildDemandTrend(skus: Sku[]): DemandTrendPoint[] {
  const now = new Date();

  const historical = Array.from({ length: 6 }, (_, idx) => {
    const monthOffset = idx - 5;
    const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);

    const total = skus.reduce((acc, sku) => {
      const history = (sku.demand_history ?? []) as number[];
      if (history.length === 0) return acc;
      const value = history[history.length - 6 + idx] ?? 0;
      return acc + safeNum(value);
    }, 0);

    return {
      period: monthLabel(monthDate),
      historical: Math.round(total),
      forecast: null,
    } as DemandTrendPoint;
  });

  const forecast = Array.from({ length: 3 }, (_, idx) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + idx + 1, 1);

    const total = skus.reduce((acc, sku) => {
      const next3 = (sku.forecast_3m ?? []) as number[];
      if (next3.length === 0) return acc;
      return acc + safeNum(next3[idx] ?? 0);
    }, 0);

    return {
      period: monthLabel(monthDate),
      historical: null,
      forecast: Math.round(total),
    } as DemandTrendPoint;
  });

  return [...historical, ...forecast];
}

function analyse(sku: Sku, cfg: Cfg): Result {
  const hist = (sku.demand_history ?? []) as number[];
  const histY = (sku.demand_history_yearly ?? []) as number[];
  const forecast3m = (sku.forecast_3m ?? []) as number[];

  // Partial windows are accepted: if fewer than 3 points exist, we use available values.
  const hist_3m = forecast3m.length > 0 ? sum(forecast3m.slice(-3)) : sum(hist.slice(-3));
  const hist_1y = histY.length > 0 ? sum(histY) : sum(hist.slice(-12));

  const created = parseSkuDate(sku.created_at);
  const ageDays = created ? (Date.now() - created.getTime()) / 86_400_000 : null;
  const is_immature = ageDays !== null && ageDays >= 0 && ageDays < 365;

  const annualFrom3m = hist_3m * 4;
  const seasonRatio = hist_1y > 0 ? Math.abs(annualFrom3m - hist_1y) / hist_1y : 0;
  const is_seasonal = seasonRatio > 0.2;

  let annual_demand: number;
  if (is_immature && hist_1y <= 0) {
    annual_demand = annualFrom3m;
  } else if (is_seasonal) {
    annual_demand = Math.max(annualFrom3m, hist_1y);
  } else {
    const recentWeight = is_immature ? 0.6 : 0.3;
    annual_demand = recentWeight * annualFrom3m + (1 - recentWeight) * hist_1y;
  }

  annual_demand = Math.max(annual_demand * Math.max(cfg.demand_multiplier, 0), 0);

  const monthly_demand = annual_demand / 12;
  const daily_demand = annual_demand / cfg.business_days_per_year;

  const last_cost = safeNum(sku.unit_cost);
  const holdingCost = Math.max(cfg.holding_rate * last_cost, 0.1);
  const orderingCost = cfg.ordering_cost;

  let eoq = 0;
  if (annual_demand > 0 && orderingCost > 0 && holdingCost > 0) {
    const raw = Math.sqrt((2 * annual_demand * orderingCost) / holdingCost);
    const cap = (annual_demand / 12) * 12;
    eoq = Math.max(Math.round(Math.min(raw, cap)), 1);
  }

  const z = zScore(cfg.service_level);
  const lead_time_days = safeNum(sku.lead_time_days, cfg.lead_time_days) || cfg.lead_time_days;
  const workingDaysPerMonth = cfg.business_days_per_year / 12;

  const monthly3m = hist_3m > 0 ? hist_3m / 3 : 0;
  const monthly1y = hist_1y > 0 ? hist_1y / 12 : 0;

  let sigmaDaily: number;
  if (monthly3m > 0 && monthly1y > 0) {
    const sigmaMonthly = Math.abs(monthly3m - monthly1y) / 2;
    sigmaDaily = Math.max(sigmaMonthly / workingDaysPerMonth, 0.1 * daily_demand);
  } else {
    sigmaDaily = daily_demand > 0 ? 0.2 * daily_demand : 0;
  }

  const volatility_ratio = daily_demand > 0 ? sigmaDaily / daily_demand : 0;
  const volatility_band = getVolatilityBand(volatility_ratio);

  const seasonMultiplier = is_seasonal ? 1.25 : 1;
  const safety_stock = Math.round(z * sigmaDaily * Math.sqrt(lead_time_days) * seasonMultiplier);
  const reorder_point = Math.round(daily_demand * lead_time_days + safety_stock);
  const max_qty = reorder_point + eoq;

  const effective_stock = safeNum(sku.stock) + safeNum(sku.on_order) + safeNum(sku.in_production);

  const coverage_days = daily_demand > 0 ? effective_stock / daily_demand : 9999;
  const shortage = Math.max(0, reorder_point - effective_stock);
  const overstock = Math.max(0, effective_stock - max_qty);

  const stockout_risk = shortage > 0 || (annual_demand > 0 && coverage_days < lead_time_days);
  const overstock_risk = overstock > 0 || (annual_demand > 0 && coverage_days > lead_time_days * 4);

  const notes: string[] = [];
  if (is_seasonal) notes.push("⚠ Saisonnalité détectée");
  if (is_immature) notes.push("⚠ SKU récent (<1 an)");
  if (volatility_band === "high") notes.push("⚠ Forte volatilité");
  if (sku.created_at && !created) notes.push("⚠ Date SKU invalide/non reconnue");
  if (last_cost === 0) notes.push("⚠ Coût unitaire = 0");

  let action = "🟢 OK";
  let actionKey: ActionKey = "ok";
  let order_qty = 0;

  if (annual_demand === 0) {
    action = "NO ACTION";
    actionKey = "none";
    notes.push("ℹ Aucune consommation");
  } else if (shortage > 0) {
    action = "🔴 ORDER NOW";
    actionKey = "urgent";
    order_qty = Math.max(eoq, max_qty - effective_stock);
    notes.push(`Stock sous ROP de ${shortage.toFixed(0)}u`);
  } else if (effective_stock <= reorder_point) {
    action = "🟡 REORDER";
    actionKey = "reorder";
    order_qty = eoq;
    notes.push("Stock au ROP");
  } else if (overstock > 0) {
    action = "🟢 OVERSTOCK";
    actionKey = "overstock";
    notes.push(`Surstock de ${overstock.toFixed(0)}u`);
  }

  return {
    sku_id: sku.id,
    sku: sku.sku_code ?? sku.name ?? sku.id.slice(0, 8),
    sku_name: sku.name ?? "",
    annual_demand,
    monthly_demand,
    daily_demand,
    lead_time_days,
    is_seasonal,
    is_immature,
    volatility_ratio,
    volatility_band,
    eoq,
    safety_stock,
    reorder_point,
    max_qty,
    effective_stock,
    coverage_days,
    shortage,
    overstock,
    stockout_risk,
    overstock_risk,
    action,
    actionKey,
    order_qty,
    notes,
    stock: safeNum(sku.stock),
    on_order: safeNum(sku.on_order),
    in_production: safeNum(sku.in_production),
  };
}

function OptimizerPage() {
  const { user } = useAuth();
  const tableSectionRef = useRef<HTMLDivElement | null>(null);

  const [skus, setSkus] = useState<Sku[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");

  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [seasonalFilter, setSeasonalFilter] = useState<BinaryFilter>("all");
  const [immatureFilter, setImmatureFilter] = useState<BinaryFilter>("all");
  const [volatilityFilter, setVolatilityFilter] = useState<VolatilityFilter>("all");
  const [highlightedSku, setHighlightedSku] = useState<string | null>(null);

  const [cfg, setCfg] = useState<Cfg>({
    ordering_cost: 50,
    holding_rate: 0.25,
    lead_time_days: 14,
    service_level: 0.95,
    business_days_per_year: 260,
    demand_multiplier: 1,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("skus")
        .select(
          "id,sku_code,name,stock,on_order,in_production,lead_time_days,unit_cost,demand_history,demand_history_yearly,forecast_3m,created_at",
        )
        .eq("user_id", user.id)
        .limit(5000);

      if (error) {
        toast.error("Erreur de chargement des SKUs");
        setLoading(false);
        return;
      }

      const loaded = data ?? [];
      setSkus(loaded);
      setResults(loaded.map((sku) => analyse(sku, cfg)));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const runAnalysis = useCallback(
    (nextCfg?: Cfg) => {
      if (skus.length === 0) {
        toast.error("Aucun SKU dans la base de données");
        return;
      }

      const activeCfg = nextCfg ?? cfg;
      setRunning(true);
      const out = skus.map((sku) => analyse(sku, activeCfg));
      setResults(out);
      setRunning(false);
      toast.success(`${out.length} SKUs analysés`);
    },
    [cfg, skus],
  );

  async function persistSkuField(
    skuId: string,
    field: "stock" | "on_order" | "in_production" | "lead_time_days",
    value: number,
  ) {
    const updatePayload =
      field === "stock"
        ? { stock: value }
        : field === "on_order"
          ? { on_order: value }
          : field === "in_production"
            ? { in_production: value }
            : { lead_time_days: value };

    const { error } = await supabase.from("skus").update(updatePayload).eq("id", skuId);
    if (error) toast.error("Mise à jour impossible pour ce SKU");
  }

  function updateSkuField(
    skuId: string,
    field: "stock" | "on_order" | "in_production" | "lead_time_days",
    value: number,
  ) {
    const nextValue = Number.isFinite(value) ? value : 0;
    setSkus((previous) => {
      const next = previous.map((sku) => (sku.id === skuId ? { ...sku, [field]: nextValue } : sku));
      setResults(next.map((sku) => analyse(sku, cfg)));
      return next;
    });
  }

  const applyScenario = useCallback(
    (nextCfg: Cfg, name: string) => {
      setCfg(nextCfg);
      runAnalysis(nextCfg);
      toast.success(`Scénario appliqué : ${name}`);
    },
    [runAnalysis],
  );

  const drillTo = useCallback(
    (options: {
      action?: ActionFilter;
      risk?: RiskFilter;
      seasonal?: BinaryFilter;
      immature?: BinaryFilter;
      volatility?: VolatilityFilter;
      sku?: string | null;
    }) => {
      if (options.action) setActionFilter(options.action);
      if (options.risk) setRiskFilter(options.risk);
      if (options.seasonal) setSeasonalFilter(options.seasonal);
      if (options.immature) setImmatureFilter(options.immature);
      if (options.volatility) setVolatilityFilter(options.volatility);
      if (options.sku !== undefined) setHighlightedSku(options.sku);
      setActiveTab("table");

      requestAnimationFrame(() => {
        tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [],
  );

  function resetFilters() {
    setSearch("");
    setActionFilter("all");
    setRiskFilter("all");
    setSeasonalFilter("all");
    setImmatureFilter("all");
    setVolatilityFilter("all");
    setHighlightedSku(null);
  }

  const demandTrend = useMemo(() => buildDemandTrend(skus), [skus]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return results.filter((r) => {
      if (q) {
        const haystack = `${r.sku} ${r.sku_name} ${r.action} ${r.notes.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (actionFilter !== "all" && r.actionKey !== actionFilter) return false;
      if (volatilityFilter !== "all" && r.volatility_band !== volatilityFilter) return false;

      if (seasonalFilter === "yes" && !r.is_seasonal) return false;
      if (seasonalFilter === "no" && r.is_seasonal) return false;

      if (immatureFilter === "yes" && !r.is_immature) return false;
      if (immatureFilter === "no" && r.is_immature) return false;

      if (riskFilter === "stockout" && !r.stockout_risk) return false;
      if (riskFilter === "overstock" && !r.overstock_risk) return false;
      if (riskFilter === "seasonal" && !r.is_seasonal) return false;
      if (riskFilter === "immature" && !r.is_immature) return false;
      if (riskFilter === "volatile" && r.volatility_band !== "high") return false;

      return true;
    });
  }, [actionFilter, immatureFilter, results, riskFilter, search, seasonalFilter, volatilityFilter]);

  const kpis = useMemo(() => {
    return results.reduce(
      (acc, r) => {
        if (r.actionKey === "urgent") acc.urgent += 1;
        else if (r.actionKey === "reorder") acc.reorder += 1;
        else if (r.actionKey === "overstock") acc.overstock += 1;
        else acc.ok += 1;

        if (r.stockout_risk) acc.stockoutRisk += 1;
        if (r.overstock_risk) acc.overstockRisk += 1;
        if (r.volatility_band === "high") acc.highVolatility += 1;

        return acc;
      },
      {
        urgent: 0,
        reorder: 0,
        overstock: 0,
        ok: 0,
        stockoutRisk: 0,
        overstockRisk: 0,
        highVolatility: 0,
      },
    );
  }, [results]);

  const stockSignals = useMemo(() => {
    return filtered
      .slice()
      .sort(
        (a, b) =>
          b.shortage +
          b.overstock +
          b.annual_demand * 0.1 -
          (a.shortage + a.overstock + a.annual_demand * 0.1),
      )
      .slice(0, 12)
      .map(
        (r) =>
          ({
            sku: r.sku,
            effective_stock: Math.round(r.effective_stock),
            reorder_point: r.reorder_point,
            max_qty: r.max_qty,
          }) as StockSignalPoint,
      );
  }, [filtered]);

  const advisoryNotes = useMemo(() => {
    const notes: Array<{
      id: string;
      title: string;
      body: string;
      tone: "danger" | "warning" | "info";
      actionLabel: string;
      onClick: () => void;
    }> = [];

    if (kpis.urgent > 0) {
      notes.push({
        id: "stockout",
        title: `${kpis.urgent} SKU en risque immédiat de rupture`,
        body: "Priorisez les SKU ORDER NOW et vérifiez la couverture vs délai fournisseur.",
        tone: "danger",
        actionLabel: "Voir les SKU urgents",
        onClick: () => drillTo({ action: "urgent", risk: "stockout", sku: null }),
      });
    }

    if (kpis.overstock > 0) {
      notes.push({
        id: "overstock",
        title: `${kpis.overstock} SKU en surstock potentiel`,
        body: "Réduisez le rythme d'approvisionnement ou mettez en place des actions promo ciblées.",
        tone: "warning",
        actionLabel: "Filtrer surstock",
        onClick: () => drillTo({ action: "overstock", risk: "overstock", sku: null }),
      });
    }

    if (kpis.highVolatility > 0) {
      notes.push({
        id: "volatility",
        title: `${kpis.highVolatility} SKU à forte volatilité`,
        body: "Ajustez le niveau de service et renforcez le stock de sécurité sur ces références.",
        tone: "info",
        actionLabel: "Voir volatilité haute",
        onClick: () => drillTo({ risk: "volatile", volatility: "high", sku: null }),
      });
    }

    const seasonalCount = results.filter((r) => r.is_seasonal).length;
    if (seasonalCount > 0) {
      notes.push({
        id: "seasonal",
        title: `${seasonalCount} SKU saisonniers`,
        body: "Anticipez les pics de demande en amont pour lisser la charge d'approvisionnement.",
        tone: "info",
        actionLabel: "Afficher saisonniers",
        onClick: () => drillTo({ risk: "seasonal", seasonal: "yes", sku: null }),
      });
    }

    const immatureCount = results.filter((r) => r.is_immature).length;
    if (immatureCount > 0) {
      notes.push({
        id: "immature",
        title: `${immatureCount} SKU immatures (< 1 an)`,
        body: "Faites des revues plus fréquentes sur les SKU récents pour stabiliser leur paramétrage.",
        tone: "warning",
        actionLabel: "Afficher immatures",
        onClick: () => drillTo({ risk: "immature", immature: "yes", sku: null }),
      });
    }

    return notes.slice(0, 4);
  }, [drillTo, kpis.highVolatility, kpis.overstock, kpis.urgent, results]);

  function exportCsv() {
    const headers = [
      "sku",
      "action",
      "order_qty",
      "annual_demand",
      "daily_demand_business_days",
      "lead_time_business_days",
      "eoq",
      "safety_stock",
      "reorder_point",
      "max_qty",
      "effective_stock",
      "coverage_business_days",
      "volatility_band",
      "notes",
    ];

    const rows = filtered.map((r) =>
      [
        r.sku,
        r.action,
        r.order_qty.toFixed(0),
        r.annual_demand.toFixed(0),
        r.daily_demand.toFixed(4),
        r.lead_time_days,
        r.eoq,
        r.safety_stock,
        r.reorder_point,
        r.max_qty,
        r.effective_stock.toFixed(0),
        r.coverage_days >= 999 ? "∞" : r.coverage_days.toFixed(0),
        r.volatility_band,
        r.notes.join(" | "),
      ]
        .map(escapeCsvCell)
        .join(","),
    );

    const csv = [headers.map(escapeCsvCell).join(","), ...rows].join("\n");
    // UTF-8 BOM is added for robust Excel import compatibility.
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory_report_hybrid.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Export CSV prêt (${filtered.length} lignes)`);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
      <header className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Inventory Optimizer Cockpit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vue interactive WCM pour piloter le stock, filtrer les risques et agir en un clic.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher (SKU, nom, action, note)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={resetFilters}>
            <Filter className="h-4 w-4 mr-2" /> Réinitialiser filtres
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="table">Table éditable</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-bold">⚙️ Paramètres & scénarios</h3>
              <div className="text-xs text-muted-foreground">
                Ajustez la configuration puis relancez pour simuler vos décisions.
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <Label className="text-xs">Coût de commande</Label>
                <Input
                  type="number"
                  value={cfg.ordering_cost}
                  onChange={(e) =>
                    setCfg({ ...cfg, ordering_cost: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Taux possession (%)</Label>
                <Input
                  type="number"
                  value={cfg.holding_rate * 100}
                  onChange={(e) =>
                    setCfg({ ...cfg, holding_rate: (parseFloat(e.target.value) || 0) / 100 })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Délai global (jours ouvrables)</Label>
                <Input
                  type="number"
                  value={cfg.lead_time_days}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    setCfg({
                      ...cfg,
                      lead_time_days:
                        !Number.isNaN(parsed) && parsed > 0 ? parsed : cfg.lead_time_days,
                    });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Niveau service (%)</Label>
                <Input
                  type="number"
                  value={cfg.service_level * 100}
                  onChange={(e) =>
                    setCfg({ ...cfg, service_level: (parseFloat(e.target.value) || 0) / 100 })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Jours ouvrables/an</Label>
                <Input
                  type="number"
                  value={cfg.business_days_per_year}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    setCfg({
                      ...cfg,
                      business_days_per_year:
                        !Number.isNaN(parsed) && parsed > 0 ? parsed : cfg.business_days_per_year,
                    });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Demande simulée (%)</Label>
                <Input
                  type="number"
                  value={Math.round(cfg.demand_multiplier * 100)}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    const multiplier = !Number.isNaN(parsed) ? Math.max(parsed / 100, 0) : 0;
                    setCfg({ ...cfg, demand_multiplier: multiplier });
                  }}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() =>
                  applyScenario(
                    { ...cfg, service_level: 0.95, holding_rate: 0.25, demand_multiplier: 1 },
                    "Balanced",
                  )
                }
              >
                Balanced
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  applyScenario(
                    { ...cfg, service_level: 0.98, holding_rate: 0.3, demand_multiplier: 1.05 },
                    "Service élevé",
                  )
                }
              >
                Service élevé
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  applyScenario(
                    { ...cfg, service_level: 0.9, holding_rate: 0.2, demand_multiplier: 0.9 },
                    "Cash prudent",
                  )
                }
              >
                Cash prudent
              </Button>
            </div>

            <div className="flex gap-2 mt-1 flex-wrap">
              <Button onClick={() => runAnalysis()} disabled={running}>
                {running ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Relancer l'analyse
              </Button>
              {results.length > 0 && (
                <>
                  <Button variant="outline" onClick={() => runAnalysis()}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Recalculer
                  </Button>
                  <Button variant="outline" onClick={exportCsv}>
                    <Download className="h-4 w-4 mr-2" /> Exporter CSV filtré
                  </Button>
                </>
              )}
            </div>
          </div>

          {results.length > 0 && (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard
                  label="Commander maintenant"
                  value={kpis.urgent}
                  active={actionFilter === "urgent"}
                  onClick={() => drillTo({ action: "urgent", risk: "stockout", sku: null })}
                />
                <KpiCard
                  label="Réapprovisionner"
                  value={kpis.reorder}
                  active={actionFilter === "reorder"}
                  onClick={() => drillTo({ action: "reorder", sku: null })}
                />
                <KpiCard
                  label="Surstock"
                  value={kpis.overstock}
                  active={actionFilter === "overstock"}
                  onClick={() => drillTo({ action: "overstock", risk: "overstock", sku: null })}
                />
                <KpiCard
                  label="Volatilité élevée"
                  value={kpis.highVolatility}
                  active={riskFilter === "volatile"}
                  onClick={() => drillTo({ risk: "volatile", volatility: "high", sku: null })}
                />
              </div>

              <div className="grid xl:grid-cols-[1.2fr_1fr] gap-4">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" /> Courbe de demande (historique
                      & prévision)
                    </h3>
                    <Badge variant="secondary" className="text-[10px]">
                      Global SKU
                    </Badge>
                  </div>
                  <div className="h-72 mt-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={demandTrend}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="period" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="historical"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                          name="Historique"
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          name="Prévision"
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" /> Conseils actionnables
                  </h3>
                  {advisoryNotes.length > 0 ? (
                    advisoryNotes.map((note) => (
                      <div
                        key={note.id}
                        className={cn(
                          "rounded-xl border p-3",
                          note.tone === "danger" && "border-red-500/30 bg-red-500/5",
                          note.tone === "warning" && "border-amber-500/30 bg-amber-500/5",
                          note.tone === "info" && "border-primary/30 bg-primary/5",
                        )}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" /> {note.title}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{note.body}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 text-xs"
                          onClick={note.onClick}
                        >
                          {note.actionLabel}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground border border-dashed rounded-xl p-4">
                      Aucun signal critique détecté.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-bold">
                    Stock vs seuils (clic barre = drill-down SKU)
                  </h3>
                  <Badge variant="outline" className="text-[10px]">
                    Top 12 priorités de la vue filtrée
                  </Badge>
                </div>
                <div className="h-72 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={stockSignals}
                      onClick={(chartState) => {
                        const sku = extractChartSku(chartState);
                        if (sku) drillTo({ sku });
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="sku" interval={0} angle={-30} textAnchor="end" height={64} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar
                        dataKey="effective_stock"
                        name="Stock effectif"
                        fill="hsl(var(--primary))"
                      />
                      <Bar dataKey="reorder_point" name="ROP" fill="#f59e0b" />
                      <Bar dataKey="max_qty" name="Max" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="table" className="space-y-4">
          {results.length > 0 ? (
            <div ref={tableSectionRef} className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold mb-3">Filtres avancés</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <FilterSelect
                    label="Action"
                    value={actionFilter}
                    onValueChange={(v) => setActionFilter(v as ActionFilter)}
                    items={[
                      { value: "all", label: "Toutes" },
                      { value: "urgent", label: "ORDER NOW" },
                      { value: "reorder", label: "REORDER" },
                      { value: "overstock", label: "OVERSTOCK" },
                      { value: "ok", label: "OK" },
                      { value: "none", label: "NO ACTION" },
                    ]}
                  />
                  <FilterSelect
                    label="Risque"
                    value={riskFilter}
                    onValueChange={(v) => setRiskFilter(v as RiskFilter)}
                    items={[
                      { value: "all", label: "Tous" },
                      { value: "stockout", label: "Rupture" },
                      { value: "overstock", label: "Surstock" },
                      { value: "volatile", label: "Volatilité haute" },
                      { value: "seasonal", label: "Saisonnier" },
                      { value: "immature", label: "Immature" },
                    ]}
                  />
                  <FilterSelect
                    label="Saisonnier"
                    value={seasonalFilter}
                    onValueChange={(v) => setSeasonalFilter(v as BinaryFilter)}
                    items={[
                      { value: "all", label: "Tous" },
                      { value: "yes", label: "Oui" },
                      { value: "no", label: "Non" },
                    ]}
                  />
                  <FilterSelect
                    label="Immature"
                    value={immatureFilter}
                    onValueChange={(v) => setImmatureFilter(v as BinaryFilter)}
                    items={[
                      { value: "all", label: "Tous" },
                      { value: "yes", label: "Oui" },
                      { value: "no", label: "Non" },
                    ]}
                  />
                  <FilterSelect
                    label="Volatilité"
                    value={volatilityFilter}
                    onValueChange={(v) => setVolatilityFilter(v as VolatilityFilter)}
                    items={[
                      { value: "all", label: "Toutes" },
                      { value: "low", label: "Faible" },
                      { value: "medium", label: "Moyenne" },
                      { value: "high", label: "Forte" },
                    ]}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">
                    📋 Données analysées ({filtered.length}/{results.length})
                  </h3>
                  {highlightedSku && <Badge variant="secondary">SKU ciblé: {highlightedSku}</Badge>}
                </div>
                <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left p-2">SKU</th>
                        <th className="text-left p-2">Nom</th>
                        <th className="text-left p-2">Action</th>
                        <th className="text-left p-2">Risque</th>
                        <th className="text-left p-2">Vol.</th>
                        <th className="text-right p-2">Stock (éditable)</th>
                        <th className="text-right p-2">En commande</th>
                        <th className="text-right p-2">En production</th>
                        <th className="text-right p-2">LT</th>
                        <th className="text-right p-2">Qté</th>
                        <th className="text-right p-2">EOQ</th>
                        <th className="text-right p-2">Min</th>
                        <th className="text-right p-2">Max</th>
                        <th className="text-right p-2">SS</th>
                        <th className="text-right p-2">Stock Eff.</th>
                        <th className="text-right p-2">Couv. ouvrable</th>
                        <th className="text-right p-2">Dem./an</th>
                        <th className="text-left p-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const rowActive = highlightedSku === r.sku;
                        return (
                          <tr
                            key={r.sku_id}
                            onClick={() => setHighlightedSku(r.sku)}
                            className={cn(
                              "border-t border-border hover:bg-muted/20 cursor-pointer",
                              rowActive && "bg-primary/10",
                            )}
                          >
                            <td className="p-2 font-mono">{r.sku}</td>
                            <td className="p-2 max-w-[180px] truncate">{r.sku_name || "—"}</td>
                            <td className="p-2 font-bold">{r.action}</td>
                            <td className="p-2">
                              <div className="flex gap-1 flex-wrap">
                                {r.stockout_risk && <Badge className="text-[10px]">Rupture</Badge>}
                                {r.overstock_risk && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    Surstock
                                  </Badge>
                                )}
                                {!r.stockout_risk && !r.overstock_risk && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Stable
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="p-2">
                              <Badge
                                variant={
                                  r.volatility_band === "high"
                                    ? "destructive"
                                    : r.volatility_band === "medium"
                                      ? "secondary"
                                      : "outline"
                                }
                                className="text-[10px]"
                              >
                                {r.volatility_band}
                              </Badge>
                            </td>
                            <td className="p-2">
                              <InlineEditNumber
                                value={r.stock}
                                onChange={(value) => updateSkuField(r.sku_id, "stock", value)}
                                onBlur={(value) => void persistSkuField(r.sku_id, "stock", value)}
                              />
                            </td>
                            <td className="p-2">
                              <InlineEditNumber
                                value={r.on_order}
                                onChange={(value) => updateSkuField(r.sku_id, "on_order", value)}
                                onBlur={(value) =>
                                  void persistSkuField(r.sku_id, "on_order", value)
                                }
                              />
                            </td>
                            <td className="p-2">
                              <InlineEditNumber
                                value={r.in_production}
                                onChange={(value) =>
                                  updateSkuField(r.sku_id, "in_production", value)
                                }
                                onBlur={(value) =>
                                  void persistSkuField(r.sku_id, "in_production", value)
                                }
                              />
                            </td>
                            <td className="p-2">
                              <InlineEditNumber
                                value={r.lead_time_days}
                                onChange={(value) =>
                                  updateSkuField(r.sku_id, "lead_time_days", value)
                                }
                                onBlur={(value) =>
                                  void persistSkuField(r.sku_id, "lead_time_days", value)
                                }
                              />
                            </td>
                            <td className="p-2 text-right font-mono">
                              {r.order_qty.toLocaleString()}
                            </td>
                            <td className="p-2 text-right font-mono">{r.eoq.toLocaleString()}</td>
                            <td className="p-2 text-right font-mono">{r.reorder_point}</td>
                            <td className="p-2 text-right font-mono">{r.max_qty}</td>
                            <td className="p-2 text-right font-mono">{r.safety_stock}</td>
                            <td className="p-2 text-right font-mono">
                              {r.effective_stock.toFixed(0)}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {r.coverage_days >= 999 ? "∞" : r.coverage_days.toFixed(0)}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {r.annual_demand.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                            <td className="p-2 text-muted-foreground max-w-[280px]">
                              {r.notes.join(" | ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              Aucun SKU dans la base. Importez vos données depuis l'onglet Gestion SKUs.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onValueChange,
  items,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineEditNumber({
  value,
  onChange,
  onBlur,
}: {
  value: number;
  onChange: (value: number) => void;
  onBlur?: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));

  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  return (
    <Input
      type="number"
      className="h-8 min-w-20 text-right font-mono"
      value={draft}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(Number.parseFloat(event.target.value) || 0);
      }}
      onBlur={() => onBlur?.(Number.parseFloat(draft) || 0)}
    />
  );
}

function KpiCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50",
        active && "border-primary bg-primary/5",
      )}
    >
      <div className="text-xs font-bold text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      <div className="text-[11px] text-primary mt-1">Cliquer pour filtrer & aller aux données</div>
    </button>
  );
}
