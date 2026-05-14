import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, Download, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_CONFIG,
  toInventorySku,
  type InventoryConfig,
  type InventoryResult,
  type InventorySku,
  weeklyRecalculation,
} from "@/lib/dynamic-inventory";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/hybrid")({
  head: () => ({ meta: [{ title: "Analyse Hybride — FlowStock" }] }),
  component: HybridInventoryPage,
});

function toCsvValue(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function HybridInventoryPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [cfg, setCfg] = useState<InventoryConfig>(DEFAULT_CONFIG);
  const [skus, setSkus] = useState<InventorySku[]>([]);
  const [results, setResults] = useState<InventoryResult[]>([]);

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

  const filtered = useMemo(() => {
    if (!search.trim()) return results;
    const q = search.toLowerCase();
    return results.filter((r) => r.skuCode.toLowerCase().includes(q));
  }, [results, search]);

  const kpis = useMemo(() => {
    return filtered.reduce(
      (acc, result) => {
        acc.totalAnnualDemand += result.annualDemand;
        acc.avgCoverageTarget += result.coverageTargetDays;
        acc.avgCoverageCurrent +=
          result.currentCoverageDays >= 9999 ? 0 : result.currentCoverageDays;
        if (result.recommendedOrderQty > 0) acc.toOrder += 1;
        if (result.recommendation.includes("Surstock")) acc.overstock += 1;
        if (result.isVolatile) acc.volatile += 1;
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
      "effective_stock",
      "current_coverage_days",
      "volatility",
      "seasonal",
      "immature",
      "recommendation",
      "recommended_order_qty",
    ];

    const rows = filtered.map((r) =>
      [
        toCsvValue(r.skuCode),
        r.annualDemand.toFixed(2),
        r.coverageTargetDays.toFixed(2),
        r.safetyStock.toFixed(0),
        r.reorderPoint.toFixed(0),
        r.maxQuantity.toFixed(0),
        r.effectiveStock.toFixed(0),
        r.currentCoverageDays >= 9999 ? "∞" : r.currentCoverageDays.toFixed(2),
        r.volatility.toFixed(4),
        r.isSeasonal ? "true" : "false",
        r.isImmature ? "true" : "false",
        toCsvValue(r.recommendation),
        r.recommendedOrderQty.toFixed(0),
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

    if (rows.length === 0) {
      toast.success("Export CSV généré (en-têtes uniquement)");
      return;
    }
    toast.success("Export CSV terminé");
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
          <h1 className="text-2xl font-bold tracking-tight">📊 Analyse Hybride</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Moteur dynamique hebdomadaire basé sur la demande historique et prévisionnelle.
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
            value={cfg.businessDaysPerYear}
            onChange={(value) => setCfg({ ...cfg, businessDaysPerYear: value })}
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
          <Button variant="outline" onClick={runAnalysis} disabled={running}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Recalcul hebdomadaire
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KpiCard label="SKUs analysés" value={filtered.length.toString()} />
        <KpiCard label="Demande annuelle" value={kpis.totalAnnualDemand.toFixed(0)} />
        <KpiCard label="À commander" value={kpis.toOrder.toString()} />
        <KpiCard label="Surstock" value={kpis.overstock.toString()} />
        <KpiCard label="Volatils" value={kpis.volatile.toString()} />
        <KpiCard
          label="Couv. cible / actuelle"
          value={`${avgTargetCoverage.toFixed(0)}j / ${avgCurrentCoverage.toFixed(0)}j`}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-bold">📋 Résultats ({filtered.length})</h3>
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
                  <th className="text-right p-2">Dem. annuelle</th>
                  <th className="text-right p-2">Couv. cible</th>
                  <th className="text-right p-2">SS</th>
                  <th className="text-right p-2">ROP</th>
                  <th className="text-right p-2">Max</th>
                  <th className="text-right p-2">Stock effectif</th>
                  <th className="text-right p-2">Couv. actuelle</th>
                  <th className="text-right p-2">Volatilité</th>
                  <th className="text-center p-2">Saisonnier</th>
                  <th className="text-center p-2">Immature</th>
                  <th className="text-right p-2">Qté recommandée</th>
                  <th className="text-left p-2">Recommandation</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.skuId} className="border-t border-border hover:bg-muted/20">
                    <td className="p-2 font-mono">{r.skuCode}</td>
                    <td className="p-2 text-right font-mono">{r.annualDemand.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">{r.coverageTargetDays.toFixed(0)}j</td>
                    <td className="p-2 text-right font-mono">{r.safetyStock.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">{r.reorderPoint.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">{r.maxQuantity.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">{r.effectiveStock.toFixed(0)}</td>
                    <td className="p-2 text-right font-mono">
                      {r.currentCoverageDays >= 9999 ? "∞" : `${r.currentCoverageDays.toFixed(0)}j`}
                    </td>
                    <td className="p-2 text-right font-mono">{r.volatility.toFixed(2)}</td>
                    <td className="p-2 text-center">{r.isSeasonal ? "Oui" : "Non"}</td>
                    <td className="p-2 text-center">{r.isImmature ? "Oui" : "Non"}</td>
                    <td className="p-2 text-right font-mono">{r.recommendedOrderQty.toFixed(0)}</td>
                    <td className="p-2">{r.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs font-bold text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
