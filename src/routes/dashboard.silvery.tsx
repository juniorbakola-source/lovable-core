import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runSilveryEngine } from "@/lib/silvery-engine";
import { toSkuInput, safeNum } from "@/lib/sku-helpers";
import { useLocale } from "@/hooks/use-locale";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  Package,
  ShoppingCart,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

// silvery_engine_runs is not yet in the generated types — use inline type
type EngineRun = {
  id: string;
  status: string;
  skus_processed: number;
  created_at: string;
  completed_at: string | null;
  trigger: string;
};

type EngineResult = {
  id: string;
  sku_code: string | null;
  min_optimized: number | null;
  max_optimized: number | null;
  break_even_qty: number | null;
  break_even_value: number | null;
  safety_stock: number | null;
  eoq: number | null;
  recommended_order: number | null;
  status: string | null;
  days_of_cover: number | null;
};

type StatusKey = "ok" | "low" | "critical" | "overstock";

const STATUS_STYLE: Record<StatusKey, { label: string; badge: string; icon: typeof CheckCircle2 }> =
  {
    ok: {
      label: "Optimal",
      badge: "bg-success/15 text-success border-success/30",
      icon: CheckCircle2,
    },
    low: {
      label: "Réappro",
      badge: "bg-warning/15 text-warning border-warning/30",
      icon: ShoppingCart,
    },
    critical: {
      label: "Rupture",
      badge: "bg-destructive/15 text-destructive border-destructive/30",
      icon: AlertTriangle,
    },
    overstock: {
      label: "Surstock",
      badge: "bg-chart-5/15 text-chart-5 border-chart-5/30",
      icon: Package,
    },
  };

export const Route = createFileRoute("/dashboard/silvery")({
  head: () => ({ meta: [{ title: "Silvery Engine — FlowStockAI" }] }),
  component: SilveryPage,
});

function SilveryPage() {
  const { user } = useAuth();
  const [skus, setSkus] = useState<Sku[]>([]);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [lastResults, setLastResults] = useState<EngineResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function loadData() {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: skuData }, { data: runData }] = await Promise.all([
      supabase.from("skus").select("*").order("sku_code"),
      sb
        .from("silvery_engine_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setSkus((skuData as Sku[] | null) ?? []);
    setRuns((runData as EngineRun[] | null) ?? []);

    // Load results from latest completed run
    const latestRun = ((runData as EngineRun[] | null) ?? []).find((r: EngineRun) => r.status === "completed");
    if (latestRun) {
      const { data: results } = await sb
        .from("silvery_engine_results")
        .select("*")
        .eq("run_id", latestRun.id)
        .order("sku_code");
      setLastResults((results as EngineResult[] | null) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function runEngine() {
    if (!user) return;
    setRunning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // Create run record
      const { data: runData, error: runErr } = await sb
        .from("silvery_engine_runs")
        .insert({ user_id: user.id, trigger: "manual", status: "running" })
        .select()
        .single();
      if (runErr) throw runErr;
      const runId = (runData as { id: string }).id;

      // Compute results
      const results = skus.map((s) => {
        const input = toSkuInput(s);
        const r = runSilveryEngine(input);
        return {
          run_id: runId,
          sku_id: s.id,
          user_id: user.id,
          sku_code: s.sku_code,
          min_optimized: r.minOptimized,
          max_optimized: r.maxOptimized,
          break_even_qty: r.breakEvenQty,
          break_even_value: r.breakEvenValue,
          safety_stock: r.safetyStock,
          eoq: r.eoq,
          recommended_order: r.recommendedOrder,
          status: r.status,
          days_of_cover: r.daysOfCover,
          input_snapshot: input as unknown as Record<string, unknown>,
        };
      });

      // Batch insert results
      const CHUNK = 500;
      for (let i = 0; i < results.length; i += CHUNK) {
        const { error } = await sb
          .from("silvery_engine_results")
          .insert(results.slice(i, i + CHUNK));
        if (error) throw error;
      }

      // Mark run as completed
      await sb
        .from("silvery_engine_runs")
        .update({
          status: "completed",
          skus_processed: skus.length,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

      toast.success(`Silvery Engine terminé — ${skus.length} SKUs calculés`);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  // Live calculation for display (not persisted) when no run yet
  const liveResults = useMemo(
    () =>
      skus.map((s) => {
        const input = toSkuInput(s);
        const r = runSilveryEngine(input);
        return { ...s, r };
      }),
    [skus],
  );

  const displayResults =
    lastResults.length > 0
      ? lastResults
      : liveResults.map(
          (s) =>
            ({
              id: s.id,
              sku_code: s.sku_code,
              min_optimized: s.r.minOptimized,
              max_optimized: s.r.maxOptimized,
              break_even_qty: s.r.breakEvenQty,
              break_even_value: s.r.breakEvenValue,
              safety_stock: s.r.safetyStock,
              eoq: s.r.eoq,
              recommended_order: s.r.recommendedOrder,
              status: s.r.status,
              days_of_cover: s.r.daysOfCover,
            }) as EngineResult,
        );

  const toReorder = displayResults.filter((r) => (r.recommended_order ?? 0) > 0).length;
  const critical = displayResults.filter((r) => r.status === "critical").length;
  const isLive = lastResults.length === 0 && skus.length > 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" /> Silvery Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Moteur S&OP — calcule Min/Max, EOQ, break-even, stock sécurité et quantité recommandée.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setShowHistory(!showHistory)} variant="outline" size="sm">
            <History className="h-4 w-4" />
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Historique
          </Button>
          <Button onClick={runEngine} disabled={running || skus.length === 0} variant="hero">
            <Zap className="h-4 w-4" />
            {running ? "Calcul en cours…" : "Lancer le moteur"}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="SKUs analysés"
          value={String(displayResults.length)}
          tone="default"
          loading={loading}
        />
        <KpiCard
          label="Commandes recommandées"
          value={String(toReorder)}
          tone="warning"
          loading={loading}
        />
        <KpiCard
          label="Ruptures critiques"
          value={String(critical)}
          tone="danger"
          loading={loading}
        />
        <KpiCard
          label="Source données"
          value={isLive ? "Calcul live" : "Dernier run"}
          tone="info"
          loading={loading}
        />
      </div>

      {/* Run history */}
      {showHistory && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold mb-3">Historique des runs</h2>
          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun run enregistré.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Déclencheur</th>
                    <th className="text-right p-2">SKUs</th>
                    <th className="text-center p-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-border">
                      <td className="p-2 font-mono">
                        {new Date(run.created_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="p-2">{run.trigger === "scheduled" ? "Planifié" : "Manuel"}</td>
                      <td className="p-2 text-right">{run.skus_processed}</td>
                      <td className="p-2 text-center">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            run.status === "completed"
                              ? "bg-success/15 text-success border-success/30"
                              : run.status === "running"
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "bg-destructive/15 text-destructive border-destructive/30",
                          )}
                        >
                          {run.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Results table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {isLive && (
          <div className="px-4 py-2 bg-primary/5 border-b border-border text-xs text-primary font-medium">
            ⚡ Calcul live — cliquez « Lancer le moteur » pour persister les résultats.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/40">
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3 text-right">Stock sécu.</th>
                <th className="px-3 py-3 text-right">EOQ</th>
                <th className="px-3 py-3 text-right">Min opt.</th>
                <th className="px-3 py-3 text-right">Max opt.</th>
                <th className="px-3 py-3 text-right">Break-even Qté</th>
                <th className="px-3 py-3 text-right">Break-even €</th>
                <th className="px-3 py-3 text-right">Jours couvert</th>
                <th className="px-3 py-3 text-center">Statut</th>
                <th className="px-3 py-3 text-right text-primary">Recommandé</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    Chargement…
                  </td>
                </tr>
              ) : displayResults.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    Aucun SKU. Ajoutez des SKUs dans Gestion SKUs.
                  </td>
                </tr>
              ) : (
                displayResults.map((r) => {
                  const sk = (r.status ?? "ok") as StatusKey;
                  const st = STATUS_STYLE[sk] ?? STATUS_STYLE.ok;
                  const Icon = st.icon;
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-3 font-mono font-bold">{r.sku_code}</td>
                      <td className="px-3 py-3 text-right text-warning font-mono">
                        {r.safety_stock ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono">{r.eoq ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-mono">{r.min_optimized ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-mono">{r.max_optimized ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-mono">{r.break_even_qty ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-mono">
                        {r.break_even_value != null
                          ? r.break_even_value.toLocaleString("fr-FR", {
                              maximumFractionDigits: 0,
                            }) + " €"
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-muted-foreground">
                        {r.days_of_cover === 999 ? "∞" : (r.days_of_cover ?? "—")}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold",
                            st.badge,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-primary">
                        {(r.recommended_order ?? 0) > 0 ? `+${r.recommended_order} u` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone: "default" | "danger" | "warning" | "info";
  loading: boolean;
}) {
  const ring =
    tone === "danger"
      ? "border-destructive/60"
      : tone === "warning"
        ? "border-warning/60"
        : tone === "info"
          ? "border-primary/40"
          : "border-border";
  return (
    <div className={`rounded-2xl border ${ring} bg-card p-4`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold">{loading ? "—" : value}</div>
    </div>
  );
}
