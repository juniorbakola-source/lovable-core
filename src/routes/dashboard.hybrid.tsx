import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
  Download,
  Search,
  RefreshCw,
  Boxes,
  AlertTriangle,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_CONFIG,
  INFINITE_COVERAGE_DAYS,
  toInventorySku,
  type InventoryConfig,
  type InventoryResult,
  type InventorySku,
  weeklyRecalculation,
} from "@/lib/dynamic-inventory";
import { cn } from "@/lib/utils";

type Sku = Database["public"]["Tables"]["skus"]["Row"];
type ActionFilter = "all" | "order_now" | "overstock" | "ok";
type BinaryFilter = "all" | "yes" | "no";

export const Route = createFileRoute("/dashboard/hybrid")({
  head: () => ({ meta: [{ title: "Analyse Hybride — FlowStock" }] }),
  component: HybridInventoryPage,
});

function toCsvValue(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function HybridInventoryPage() {
  const { user } = useAuth();
  const tableSectionRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [cfg, setCfg] = useState<InventoryConfig>(DEFAULT_CONFIG);
  const [skus, setSkus] = useState<InventorySku[]>([]);
  const [results, setResults] = useState<InventoryResult[]>([]);

  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [seasonalFilter, setSeasonalFilter] = useState<BinaryFilter>("all");
  const [volatilityFilter, setVolatilityFilter] = useState<BinaryFilter>("all");

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("skus").select("*").eq("user_id", user.id);
      if (error) {
        toast.error("Erreur lors du chargement des SKUs");
        setLoading(false);
        return;
      }
      const mapped = (data ?? []).map((row: Sku) => toInventorySku(row));
      setSkus(mapped);
      setResults(weeklyRecalculation(mapped, cfg));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (loading) return;
    setResults(weeklyRecalculation(skus, cfg));
  }, [cfg, loading, skus]);

  function runAnalysis() {
    if (skus.length === 0) {
      toast.error("Aucun SKU disponible");
      setResults([]);
      return;
    }
    setRunning(true);
    setTimeout(() => {
      const output = weeklyRecalculation(skus, cfg);
      setResults(output);
      setRunning(false);
      toast.success(`${output.length} SKUs analysés`);
    }, 50);
  }

  async function persistSkuField(
    skuId: string,
    field: "stock" | "onOrder" | "inProduction",
    value: number,
  ) {
    const updatePayload =
      field === "stock"
        ? { stock: value }
        : field === "onOrder"
          ? { on_order: value }
          : { in_production: value };

    const { error } = await supabase.from("skus").update(updatePayload).eq("id", skuId);
    if (error) toast.error("Mise à jour impossible pour ce SKU");
  }

  function updateSkuField(
    skuId: string,
    field: "stock" | "reserved" | "onOrder" | "inProduction",
    value: number,
  ) {
    setSkus((previous) =>
      previous.map((sku) =>
        sku.id === skuId ? { ...sku, [field]: Number.isFinite(value) ? value : 0 } : sku,
      ),
    );
  }

  function drillTo(options: {
    action?: ActionFilter;
    seasonal?: BinaryFilter;
    volatility?: BinaryFilter;
  }) {
    if (options.action) setActionFilter(options.action);
    if (options.seasonal) setSeasonalFilter(options.seasonal);
    if (options.volatility) setVolatilityFilter(options.volatility);
    setActiveTab("table");

    requestAnimationFrame(() => {
      tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function resetFilters() {
    setSearch("");
    setActionFilter("all");
    setSeasonalFilter("all");
    setVolatilityFilter("all");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (q) {
        const rowText = `${r.skuCode} ${r.action} ${r.recommendations.join(" ")}`.toLowerCase();
        if (!rowText.includes(q)) return false;
      }

      if (actionFilter === "order_now" && r.action !== "🔴 ORDER NOW") return false;
      if (actionFilter === "overstock" && r.action !== "🟢 OVERSTOCK") return false;
      if (actionFilter === "ok" && r.action !== "🟢 OK") return false;

      if (seasonalFilter === "yes" && !r.seasonal) return false;
      if (seasonalFilter === "no" && r.seasonal) return false;

      const isHighVolatility = r.volatility > 0.5;
      if (volatilityFilter === "yes" && !isHighVolatility) return false;
      if (volatilityFilter === "no" && isHighVolatility) return false;

      return true;
    });
  }, [actionFilter, results, search, seasonalFilter, volatilityFilter]);

  const kpis = useMemo(() => {
    return filtered.reduce(
      (acc, result) => {
        acc.totalAnnualDemand += result.annualDemand;
        acc.avgCoverageTarget += result.coverageTargetDays;
        acc.avgCoverageCurrent +=
          result.currentCoverageDays >= INFINITE_COVERAGE_DAYS ? 0 : result.currentCoverageDays;
        if (result.action === "🔴 ORDER NOW") acc.toOrder += 1;
        if (result.action === "🟢 OVERSTOCK") acc.overstock += 1;
        if (result.volatility > 0.5) acc.volatile += 1;
        return acc;
      },
      {
        totalAnnualDemand: 0,
        avgCoverageTarget: 0,
        avgCoverageCurrent: 0,
        toOrder: 0,
        overstock: 0,
        volatile: 0,
      },
    );
  }, [filtered]);

  function exportCsv() {
    const headers = [
      "sku",
      "annual_demand",
      "coverage_target_days",
      "safety_stock",
      "reorder_point",
      "max_quantity",
      "available_stock",
      "effective_stock",
      "current_coverage_days",
      "volatility",
      "seasonal",
      "immature",
      "action",
      "recommendations",
    ];

    const rows = filtered.map((r) =>
      [
        toCsvValue(r.skuCode),
        r.annualDemand.toFixed(2),
        r.coverageTargetDays.toFixed(2),
        r.safetyStock.toFixed(0),
        r.reorderPoint.toFixed(0),
        r.maxQty.toFixed(0),
        r.availableStock.toFixed(0),
        r.effectiveStock.toFixed(0),
        r.currentCoverageDays >= INFINITE_COVERAGE_DAYS ? "∞" : r.currentCoverageDays.toFixed(2),
        r.volatility.toFixed(4),
        r.seasonal ? "true" : "false",
        r.immature ? "true" : "false",
        toCsvValue(r.action),
        toCsvValue(r.recommendations.join(" | ")),
      ].join(","),
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "analyse_hybride.csv";
    anchor.click();
    URL.revokeObjectURL(url);

    toast.success(
      rows.length === 0 ? "Export CSV généré (en-têtes uniquement)" : "Export CSV terminé",
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  const count = filtered.length || 1;
  const avgTargetCoverage = kpis.avgCoverageTarget / count;
  const avgCurrentCoverage = kpis.avgCoverageCurrent / count;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Analyse Hybride
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dashboard dynamique + table éditable, alignés avec l'expérience Vue Globale.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher (SKU, action, recommandation)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="table">Table éditable</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold mb-4">⚙️ Paramètres moteur</h3>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              <ConfigNumberInput
                label="Coût de commande"
                value={cfg.orderingCost}
                onChange={(value) => setCfg({ ...cfg, orderingCost: value })}
              />
              <ConfigNumberInput
                label="Taux de possession (%)"
                value={cfg.holdingRate * 100}
                onChange={(value) => setCfg({ ...cfg, holdingRate: value / 100 })}
              />
              <ConfigNumberInput
                label="Délai (jours)"
                value={cfg.leadTimeDays}
                onChange={(value) => setCfg({ ...cfg, leadTimeDays: value })}
              />
              <ConfigNumberInput
                label="Niveau de service (%)"
                value={cfg.serviceLevel * 100}
                onChange={(value) => setCfg({ ...cfg, serviceLevel: value / 100 })}
              />
              <ConfigNumberInput
                label="Jours ouvrables/an"
                value={cfg.businessDaysYear}
                onChange={(value) => setCfg({ ...cfg, businessDaysYear: value })}
              />
              <ConfigNumberInput
                label="Poids prévision"
                value={cfg.forecastWeight}
                onChange={(value) => setCfg({ ...cfg, forecastWeight: value })}
              />
              <ConfigNumberInput
                label="Poids historique"
                value={cfg.historyWeight}
                onChange={(value) => setCfg({ ...cfg, historyWeight: value })}
              />
              <ConfigNumberInput
                label="Seuil volatilité"
                value={cfg.volatilityThreshold}
                onChange={(value) => setCfg({ ...cfg, volatilityThreshold: value })}
              />
              <ConfigNumberInput
                label="Période de revue (jours)"
                value={cfg.reviewPeriodDays}
                onChange={(value) => setCfg({ ...cfg, reviewPeriodDays: value })}
              />
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button onClick={runAnalysis} disabled={running}>
                {running ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Lancer l’analyse
              </Button>
              <Button variant="outline" onClick={() => setCfg(DEFAULT_CONFIG)} disabled={running}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Réinitialiser paramètres
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </section>

          <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              label="SKUs analysés"
              value={filtered.length.toString()}
              sub="Scope actif"
              icon={Boxes}
              onClick={() => drillTo({ action: "all", seasonal: "all", volatility: "all" })}
            />
            <MetricCard
              label="Commander maintenant"
              value={kpis.toOrder.toString()}
              sub="Stock effectif sous ROP"
              icon={AlertTriangle}
              tone="danger"
              onClick={() => drillTo({ action: "order_now" })}
            />
            <MetricCard
              label="Volatils"
              value={kpis.volatile.toString()}
              sub="Volatilité > 0.5"
              icon={TrendingUp}
              tone="warning"
              onClick={() => drillTo({ volatility: "yes" })}
            />
            <MetricCard
              label="Couverture cible / actuelle"
              value={`${avgTargetCoverage.toFixed(0)}j / ${avgCurrentCoverage.toFixed(0)}j`}
              sub="Moyennes sur vue active"
              icon={Sparkles}
              tone="info"
              onClick={() => drillTo({ action: "all" })}
            />
          </section>
        </TabsContent>

        <TabsContent value="table" className="space-y-4">
          <div ref={tableSectionRef} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-bold">Filtres rapides</h3>
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Réinitialiser filtres
              </Button>
            </div>
            <div className="mt-3 grid sm:grid-cols-3 gap-3">
              <QuickFilterSelect
                label="Action"
                value={actionFilter}
                onValueChange={(v) => setActionFilter(v as ActionFilter)}
                items={[
                  { value: "all", label: "Toutes" },
                  { value: "order_now", label: "ORDER NOW" },
                  { value: "overstock", label: "OVERSTOCK" },
                  { value: "ok", label: "OK" },
                ]}
              />
              <QuickFilterSelect
                label="Saisonnier"
                value={seasonalFilter}
                onValueChange={(v) => setSeasonalFilter(v as BinaryFilter)}
                items={[
                  { value: "all", label: "Tous" },
                  { value: "yes", label: "Oui" },
                  { value: "no", label: "Non" },
                ]}
              />
              <QuickFilterSelect
                label="Volatilité haute"
                value={volatilityFilter}
                onValueChange={(v) => setVolatilityFilter(v as BinaryFilter)}
                items={[
                  { value: "all", label: "Tous" },
                  { value: "yes", label: "Oui" },
                  { value: "no", label: "Non" },
                ]}
              />
            </div>
          </div>

          <section className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold">📋 Résultats ({filtered.length})</h3>
              <Badge variant="secondary">Édition locale + sync SKU</Badge>
            </div>
            {filtered.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Aucun résultat disponible. Lancez l’analyse ou importez des SKUs.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="text-left p-2">SKU</th>
                      <th className="text-left p-2">Action</th>
                      <th className="text-right p-2">Stock</th>
                      <th className="text-right p-2">Réservé</th>
                      <th className="text-right p-2">Commande</th>
                      <th className="text-right p-2">Production</th>
                      <th className="text-right p-2">Dem. annuelle</th>
                      <th className="text-right p-2">ROP</th>
                      <th className="text-right p-2">Max</th>
                      <th className="text-right p-2">Stock effectif</th>
                      <th className="text-right p-2">Couv. actuelle</th>
                      <th className="text-left p-2">Recommandations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.skuId} className="border-t border-border hover:bg-muted/20">
                        <td className="p-2 font-mono">{r.skuCode}</td>
                        <td className="p-2 font-bold">{r.action}</td>
                        <td className="p-2">
                          <InlineNumberInput
                            value={r.stock}
                            onChange={(value) => updateSkuField(r.skuId, "stock", value)}
                            onBlur={(value) => void persistSkuField(r.skuId, "stock", value)}
                          />
                        </td>
                        <td className="p-2">
                          <InlineNumberInput
                            value={r.reserved}
                            onChange={(value) => updateSkuField(r.skuId, "reserved", value)}
                          />
                        </td>
                        <td className="p-2">
                          <InlineNumberInput
                            value={r.onOrder}
                            onChange={(value) => updateSkuField(r.skuId, "onOrder", value)}
                            onBlur={(value) => void persistSkuField(r.skuId, "onOrder", value)}
                          />
                        </td>
                        <td className="p-2">
                          <InlineNumberInput
                            value={r.inProduction}
                            onChange={(value) => updateSkuField(r.skuId, "inProduction", value)}
                            onBlur={(value) => void persistSkuField(r.skuId, "inProduction", value)}
                          />
                        </td>
                        <td className="p-2 text-right font-mono">{r.annualDemand.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono">{r.reorderPoint.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono">{r.maxQty.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono">{r.effectiveStock.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono">
                          {r.currentCoverageDays >= INFINITE_COVERAGE_DAYS
                            ? "∞"
                            : `${r.currentCoverageDays.toFixed(0)}j`}
                        </td>
                        <td className="p-2 max-w-[260px]">
                          {r.recommendations.join(" | ") || "RAS"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

function InlineNumberInput({
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
      className="h-8 min-w-24 text-right font-mono"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(Number.parseFloat(e.target.value) || 0);
      }}
      onBlur={() => {
        const parsed = Number.parseFloat(draft) || 0;
        onBlur?.(parsed);
      }}
    />
  );
}

function QuickFilterSelect({
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

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Boxes;
  tone?: "default" | "danger" | "warning" | "info";
  onClick: () => void;
}) {
  const ring =
    tone === "danger"
      ? "border-destructive/60"
      : tone === "warning"
        ? "border-warning/60"
        : tone === "info"
          ? "border-primary/40"
          : "border-border";
  const iconColor =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary";

  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 text-left hover:border-primary/60 hover:shadow-[var(--shadow-elegant)] transition-all",
        ring,
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
          {label}
        </div>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </button>
  );
}
