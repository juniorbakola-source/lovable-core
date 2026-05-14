import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, RefreshCw, Download, Search } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/optimizer")({
  head: () => ({ meta: [{ title: "Inventory Optimizer — FlowStock" }] }),
  component: OptimizerPage,
});

// ─── Config & Calculation Engine ────────────────────────────────────────────
type Cfg = {
  ordering_cost: number;
  holding_rate: number;
  lead_time_days: number;
  service_level: number;
  business_days_per_year: number;
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

  // Supabase/ISO and imported values such as "2007-06-12 00:00".
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  // Guard against accidental placeholder/future dates.
  const year = parsed.getFullYear();
  if (year < 1900 || parsed.getTime() > Date.now()) return null;
  return parsed;
}

type ActionKey = "urgent" | "reorder" | "overstock" | "ok" | "none";

type Result = {
  sku_id: string;
  sku: string;
  annual_demand: number;
  monthly_demand: number;
  daily_demand: number;
  lead_time_days: number;
  is_seasonal: boolean;
  is_immature: boolean;
  eoq: number;
  safety_stock: number;
  reorder_point: number;
  max_qty: number;
  effective_stock: number;
  coverage_days: number;
  shortage: number;
  overstock: number;
  action: string;
  actionKey: ActionKey;
  order_qty: number;
  notes: string[];
};

function sum(values: number[] | null | undefined) {
  return (values ?? []).reduce((total, value) => total + safeNum(value), 0);
}

function analyse(sku: Sku, cfg: Cfg): Result {
  const hist = (sku.demand_history ?? []) as number[];
  const histY = (sku.demand_history_yearly ?? []) as number[];
  const forecast3m = (sku.forecast_3m ?? []) as number[];

  // Prefer explicit 3M forecast when present; otherwise use last 3 months history.
  const hist_3m = forecast3m.length > 0
    ? sum(forecast3m.slice(-3))
    : sum(hist.slice(-3));

  const hist_1y = histY.length > 0
    ? sum(histY)
    : sum(hist.slice(-12));

  const created = parseSkuDate(sku.created_at);
  const ageDays = created ? (Date.now() - created.getTime()) / 86_400_000 : null;

  // Important fix: missing or invalid date must NOT mark a SKU as recent.
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
    // Mature/stable SKUs trust full-year history more than recent signal.
    // Immature SKUs with annual history still lean more on recent demand.
    const recentWeight = is_immature ? 0.6 : 0.3;
    annual_demand = recentWeight * annualFrom3m + (1 - recentWeight) * hist_1y;
  }
  annual_demand = Math.max(annual_demand, 0);

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

  const seasonMultiplier = is_seasonal ? 1.25 : 1;
  const safety_stock = Math.round(z * sigmaDaily * Math.sqrt(lead_time_days) * seasonMultiplier);
  const reorder_point = Math.round(daily_demand * lead_time_days + safety_stock);
  const max_qty = reorder_point + eoq;

  // Effective stock uses available operational position, not reserved stock.
  const effective_stock =
    safeNum(sku.stock) + safeNum(sku.on_order) + safeNum(sku.in_production);

  const coverage_days = daily_demand > 0 ? effective_stock / daily_demand : 9999;
  const shortage = Math.max(0, reorder_point - effective_stock);
  const overstock = Math.max(0, effective_stock - max_qty);

  const notes: string[] = [];
  if (is_seasonal) notes.push("⚠ Saisonnalité détectée");
  if (is_immature) notes.push("⚠ SKU récent (<1 an)");
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
    annual_demand,
    monthly_demand,
    daily_demand,
    lead_time_days,
    is_seasonal,
    is_immature,
    eoq,
    safety_stock,
    reorder_point,
    max_qty,
    effective_stock,
    coverage_days,
    shortage,
    overstock,
    action,
    actionKey,
    order_qty,
    notes,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────
function OptimizerPage() {
  const { user } = useAuth();
  const [skus, setSkus] = useState<Sku[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [cfg, setCfg] = useState<Cfg>({
    ordering_cost: 50,
    holding_rate: 0.25,
    lead_time_days: 14,
    service_level: 0.95,
    business_days_per_year: 260,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("skus")
        .select("*")
        .eq("user_id", user.id);

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

  function runAnalysis() {
    if (skus.length === 0) {
      toast.error("Aucun SKU dans la base de données");
      return;
    }
    setRunning(true);
    setTimeout(() => {
      const out = skus.map((sku) => analyse(sku, cfg));
      setResults(out);
      setRunning(false);
      toast.success(`${out.length} SKUs analysés`);
    }, 50);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return results;
    const q = search.toLowerCase();
    return results.filter((r) => r.sku.toLowerCase().includes(q));
  }, [results, search]);

  const kpis = useMemo(() => {
    return results.reduce(
      (acc, r) => {
        if (r.actionKey === "urgent") acc.urgent += 1;
        else if (r.actionKey === "reorder") acc.reorder += 1;
        else if (r.actionKey === "overstock") acc.overstock += 1;
        else acc.ok += 1;
        return acc;
      },
      { urgent: 0, reorder: 0, overstock: 0, ok: 0 },
    );
  }, [results]);

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
      "notes",
    ];
    const rows = results.map((r) =>
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
        `"${r.notes.join(" | ")}"`,
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📦 Inventory Optimizer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            EOQ, Safety Stock, Min/Max et couverture calculés en jours ouvrables.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold mb-4">⚙️ Paramètres</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <Label className="text-xs">Coût de commande</Label>
            <Input
              type="number"
              value={cfg.ordering_cost}
              onChange={(e) => setCfg({ ...cfg, ordering_cost: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-xs">Taux possession (%)</Label>
            <Input
              type="number"
              value={cfg.holding_rate * 100}
              onChange={(e) => setCfg({ ...cfg, holding_rate: (parseFloat(e.target.value) || 0) / 100 })}
            />
          </div>
          <div>
            <Label className="text-xs">Délai global (jours ouvrables)</Label>
            <Input
              type="number"
              value={cfg.lead_time_days}
              onChange={(e) => setCfg({ ...cfg, lead_time_days: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-xs">Niveau service (%)</Label>
            <Input
              type="number"
              value={cfg.service_level * 100}
              onChange={(e) => setCfg({ ...cfg, service_level: (parseFloat(e.target.value) || 0) / 100 })}
            />
          </div>
          <div>
            <Label className="text-xs">Jours ouvrables/an</Label>
            <Input
              type="number"
              value={cfg.business_days_per_year}
              onChange={(e) => setCfg({ ...cfg, business_days_per_year: parseInt(e.target.value) || 260 })}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          <Button onClick={runAnalysis} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Relancer l’analyse
          </Button>
          {results.length > 0 && (
            <>
              <Button variant="outline" onClick={runAnalysis}>
                <RefreshCw className="h-4 w-4 mr-2" /> Recalculer
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" /> Exporter CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Commander" value={kpis.urgent} />
          <KpiCard label="Réapprovisionner" value={kpis.reorder} />
          <KpiCard label="Surstock" value={kpis.overstock} />
          <KpiCard label="OK" value={kpis.ok} />
        </div>
      )}

      {results.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-bold">📋 Rapport ({filtered.length}/{results.length})</h3>
          </div>
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">Action</th>
                  <th className="text-right p-2">Qté</th>
                  <th className="text-right p-2">EOQ</th>
                  <th className="text-right p-2">Min</th>
                  <th className="text-right p-2">Max</th>
                  <th className="text-right p-2">SS</th>
                  <th className="text-right p-2">Stock Eff.</th>
                  <th className="text-right p-2">Couv. ouvrable</th>
                  <th className="text-right p-2">LT ouvrable</th>
                  <th className="text-right p-2">Dem./an</th>
                  <th className="text-left p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.sku_id} className="border-t border-border hover:bg-muted/20">
                    <td className="p-2 font-mono">{r.sku}</td>
                    <td className="p-2 font-bold">{r.action}</td>
                    <td className="p-2 text-right font-mono">{r.order_qty.toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{r.eoq.toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{r.reorder_point}</td>
                    <td className="p-2 text-right font-mono">{r.max_qty}</td>
                    <td className="p-2 text-right font-mono">{r.safety_stock}</td>
                    <td className="p-2 text-right font-mono">{r.effective_stock.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">
                      {r.coverage_days >= 999 ? "∞" : r.coverage_days.toFixed(0)}
                    </td>
                    <td className="p-2 text-right font-mono">{r.lead_time_days}</td>
                    <td className="p-2 text-right font-mono">
                      {r.annual_demand.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-muted-foreground max-w-[260px]">
                      {r.notes.join(" | ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          Aucun SKU dans la base. Importez vos données depuis l’onglet Gestion SKUs.
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs font-bold text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  );
}
