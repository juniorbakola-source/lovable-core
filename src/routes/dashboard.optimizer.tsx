import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/optimizer")({
  head: () => ({ meta: [{ title: "Inventory Optimizer — FlowStock" }] }),
  component: OptimizerPage,
});

// ─── Config & Calc ──────────────────────────────────────────────────────────
type Cfg = {
  ordering_cost: number;
  holding_rate: number;
  lead_time_days: number;
  service_level: number;
};

const Z_TABLE: Record<string, number> = {
  "0.8": 0.842, "0.85": 1.036, "0.9": 1.282, "0.95": 1.645, "0.97": 1.881, "0.99": 2.326,
};

const zScore = (sl: number) => {
  const k = Object.keys(Z_TABLE).reduce((a, b) =>
    Math.abs(parseFloat(b) - sl) < Math.abs(parseFloat(a) - sl) ? b : a,
  );
  return Z_TABLE[k];
};

type Result = {
  sku_id: string;
  sku: string;
  annual_demand: number;
  monthly_demand: number;
  daily_demand: number;
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
  order_qty: number;
  notes: string[];
};

function analyse(sku: Sku, cfg: Cfg): Result {
  const hist = (sku.demand_history ?? []) as number[];
  const histY = (sku.demand_history_yearly ?? []) as number[];
  const hist_3m = hist.slice(-3).reduce((a, b) => a + Number(b || 0), 0);
  const hist_1y = histY.length
    ? histY.reduce((a, b) => a + Number(b || 0), 0)
    : hist.slice(-12).reduce((a, b) => a + Number(b || 0), 0);

  const created = sku.created_at ? new Date(sku.created_at) : null;
  const age = created ? (Date.now() - created.getTime()) / 86400000 : null;
  const is_immature = age !== null && age < 365;

  const annual4x = 4 * hist_3m;
  const seasonRatio = hist_1y > 0 ? Math.abs(annual4x - hist_1y) / hist_1y : 0;
  const is_seasonal = seasonRatio > 0.2;

  let annual_demand: number;
  if (is_immature && hist_1y <= 0) annual_demand = annual4x;
  else if (is_seasonal) annual_demand = Math.max(annual4x, hist_1y);
  else annual_demand = 0.6 * annual4x + 0.4 * hist_1y;
  annual_demand = Math.max(annual_demand, 0);

  const monthly_demand = annual_demand / 12;
  const daily_demand = annual_demand / 365;

  const last_cost = Number(sku.unit_cost ?? 0);
  const H = Math.max(cfg.holding_rate * last_cost, 0.1);
  const S = cfg.ordering_cost;
  let eoq = 0;
  if (annual_demand > 0 && S > 0 && H > 0) {
    const raw = Math.sqrt((2 * annual_demand * S) / H);
    const cap = (annual_demand / 12) * 12;
    eoq = Math.max(Math.round(Math.min(raw, cap)), 1);
  }

  const z = zScore(cfg.service_level);
  const lt = sku.lead_time_days ?? cfg.lead_time_days;
  const dailyHist3 = hist_3m > 0 ? hist_3m / 90 : 0;
  const monthlyHist1 = hist_1y > 0 ? hist_1y / 12 : 0;
  let sigma: number;
  if (dailyHist3 > 0 && monthlyHist1 > 0) {
    const diff = Math.abs(dailyHist3 - monthlyHist1 / 30) / 2;
    sigma = Math.max(diff, 0.1 * daily_demand);
  } else sigma = daily_demand > 0 ? 0.2 * daily_demand : 0;
  const seasonMult = is_seasonal ? 1.25 : 1;
  const safety_stock = Math.round(z * sigma * Math.sqrt(lt) * seasonMult);

  const reorder_point = Math.round(daily_demand * lt + safety_stock);
  const max_qty = reorder_point + eoq;
  const effective_stock =
    Number(sku.stock ?? 0) + Number(sku.on_order ?? 0) + Number(sku.in_production ?? 0);
  const coverage_days = daily_demand > 0 ? effective_stock / daily_demand : 9999;
  const shortage = Math.max(0, reorder_point - effective_stock);
  const overstock = Math.max(0, effective_stock - max_qty);

  const notes: string[] = [];
  if (is_seasonal) notes.push("⚠ Saisonnalité détectée");
  if (is_immature) notes.push("⚠ SKU récent (<1 an)");
  if (last_cost === 0) notes.push("⚠ Coût unitaire = 0");

  let action = "🟢 OK";
  let order_qty = 0;
  if (annual_demand === 0) {
    action = "NO ACTION";
    notes.push("ℹ Aucune consommation");
  } else if (shortage > 0) {
    action = "🔴 ORDER NOW";
    order_qty = Math.max(eoq, max_qty - effective_stock);
    notes.push(`Stock sous ROP de ${shortage.toFixed(0)}u`);
  } else if (effective_stock <= reorder_point) {
    action = "🟡 REORDER";
    order_qty = eoq;
    notes.push("Stock au ROP");
  } else if (overstock > 0) {
    action = "🟢 OVERSTOCK";
    notes.push(`Surstock de ${overstock.toFixed(0)}u`);
  }

  return {
    sku_id: sku.id,
    sku: sku.sku_code ?? sku.name ?? sku.id.slice(0, 8),
    annual_demand,
    monthly_demand,
    daily_demand,
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
  const [cached, setCached] = useState(false);
  const [search, setSearch] = useState("");
  const [cfg, setCfg] = useState<Cfg>({
    ordering_cost: 50,
    holding_rate: 0.25,
    lead_time_days: 14,
    service_level: 0.95,
  });

  const cacheKey = user ? `optimizer-results-${user.id}` : null;

  // Initial load — fetch SKUs and check cache
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
      setSkus(data ?? []);
      // Check cache — "Si elle existe, ne pas exécuter"
      if (cacheKey) {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.results?.length) {
              setResults(parsed.results);
              setCached(true);
              if (parsed.cfg) setCfg(parsed.cfg);
            }
          } catch {
            // ignore
          }
        }
      }
      setLoading(false);
    })();
  }, [user, cacheKey]);

  // Auto-run on first load if no cache and SKUs present
  useEffect(() => {
    if (loading || cached || running || results.length > 0) return;
    if (skus.length === 0) return;
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cached, skus.length]);

  function runAnalysis() {
    if (skus.length === 0) {
      toast.error("Aucun SKU dans la base de données");
      return;
    }
    setRunning(true);
    setTimeout(() => {
      const out = skus.map((s) => analyse(s, cfg));
      setResults(out);
      setCached(false);
      if (cacheKey) {
        localStorage.setItem(cacheKey, JSON.stringify({ results: out, cfg, ts: Date.now() }));
      }
      setRunning(false);
      toast.success(`${out.length} SKUs analysés`);
    }, 50);
  }

  function clearCache() {
    if (cacheKey) localStorage.removeItem(cacheKey);
    setResults([]);
    setCached(false);
    toast.success("Cache effacé — relance possible");
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return results;
    const q = search.toLowerCase();
    return results.filter((r) => r.sku.toLowerCase().includes(q));
  }, [results, search]);

  const kpis = useMemo(() => {
    let urgent = 0, reorder = 0, overstock = 0, ok = 0;
    for (const r of results) {
      if (r.action.startsWith("🔴")) urgent++;
      else if (r.action.startsWith("🟡")) reorder++;
      else if (r.action.startsWith("🟢 OVERSTOCK")) overstock++;
      else ok++;
    }
    return { urgent, reorder, overstock, ok };
  }, [results]);

  function exportCsv() {
    const headers = [
      "sku", "action", "order_qty", "annual_demand", "eoq",
      "safety_stock", "reorder_point", "max_qty", "effective_stock",
      "coverage_days", "notes",
    ];
    const rows = results.map((r) =>
      [
        r.sku, r.action, r.order_qty, r.annual_demand.toFixed(0), r.eoq,
        r.safety_stock, r.reorder_point, r.max_qty, r.effective_stock.toFixed(0),
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
      <header>
        <h1 className="text-2xl font-bold tracking-tight">📦 Inventory Optimizer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calcul EOQ, Stock de Sécurité, Min (ROP) et Max sur les SKUs de votre base.
          {cached && (
            <span className="ml-2 text-primary">
              · Résultats en cache (pas de recalcul)
            </span>
          )}
        </p>
      </header>

      {/* Config */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold mb-4">⚙️ Paramètres</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
              onChange={(e) =>
                setCfg({ ...cfg, holding_rate: (parseFloat(e.target.value) || 0) / 100 })
              }
            />
          </div>
          <div>
            <Label className="text-xs">Délai (jours)</Label>
            <Input
              type="number"
              value={cfg.lead_time_days}
              onChange={(e) =>
                setCfg({ ...cfg, lead_time_days: parseInt(e.target.value) || 0 })
              }
            />
          </div>
          <div>
            <Label className="text-xs">Niveau de service (%)</Label>
            <Input
              type="number"
              value={cfg.service_level * 100}
              onChange={(e) =>
                setCfg({ ...cfg, service_level: (parseFloat(e.target.value) || 0) / 100 })
              }
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          <Button onClick={runAnalysis} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {results.length === 0 ? "Lancer l'analyse" : "Relancer"}
          </Button>
          {results.length > 0 && (
            <>
              <Button variant="outline" onClick={clearCache}>
                <RefreshCw className="h-4 w-4 mr-2" /> Effacer le cache
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" /> Exporter CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPIs */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "🔴 Commander", val: kpis.urgent, c: "text-red-500" },
            { label: "🟡 Réapprovisionner", val: kpis.reorder, c: "text-amber-500" },
            { label: "🟢 Surstock", val: kpis.overstock, c: "text-green-500" },
            { label: "🟢 OK", val: kpis.ok, c: "text-muted-foreground" },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
              <div className={`text-xs font-bold ${k.c}`}>{k.label}</div>
              <div className="text-3xl font-bold mt-1">{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {results.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-2 border-b border-border">
            <h3 className="text-sm font-bold">📋 Rapport ({filtered.length})</h3>
            <Input
              placeholder="Rechercher SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
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
                  <th className="text-right p-2">Couv. (j)</th>
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
                    <td className="p-2 text-right font-mono">
                      {r.annual_demand.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="p-2 text-muted-foreground truncate max-w-[200px]">
                      {r.notes.join(" | ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results.length === 0 && skus.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          Aucun SKU dans la base. Importez vos données depuis l'onglet « Gestion SKUs ».
        </div>
      )}
    </div>
  );
}
