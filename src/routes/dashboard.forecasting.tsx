import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  extractSkuFeatures,
  buildForecastSeries,
  computeForecastMetrics,
  type SkuFeatures,
  type ForecastMetrics,
} from "@/lib/time-series";
import type { Database } from "@/integrations/supabase/types";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Package,
  Clock,
  BarChart2,
  Zap,
} from "lucide-react";

type SkuRow = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/forecasting")({
  head: () => ({ meta: [{ title: "Séries Temporelles IA — FlowStockAI" }] }),
  component: ForecastingPage,
});

function ForecastingPage() {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("skus")
      .select("*")
      .order("sku_code")
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message);
        } else {
          const list = (data as SkuRow[] | null) ?? [];
          setSkus(list);
          if (list[0]) setSelected(list[0].id);
        }
        setLoading(false);
      });
  }, []);

  const skuRow = skus.find((s) => s.id === selected);

  const features: SkuFeatures | null = useMemo(() => {
    if (!skuRow) return null;
    return extractSkuFeatures(skuRow);
  }, [skuRow]);

  const series = useMemo(() => {
    if (!features) return [];
    return buildForecastSeries(features);
  }, [features]);

  const metrics: ForecastMetrics | null = useMemo(() => {
    if (!features) return null;
    return computeForecastMetrics(features);
  }, [features]);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 text-muted-foreground">
        <TrendingUp className="h-5 w-5 animate-pulse text-primary" />
        <span className="font-mono text-sm">Chargement des séries temporelles…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center gap-3 text-destructive">
        <AlertCircle className="h-5 w-5" />
        <span className="text-sm font-medium">Erreur : {error}</span>
      </div>
    );
  }

  if (skus.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Aucun SKU. Charge des données pour voir les séries temporelles.</p>
      </div>
    );
  }

  if (!features || !metrics) {
    return <div className="p-8 text-muted-foreground font-mono text-sm">Chargement…</div>;
  }

  const stock = features.stock;
  const maxBar = Math.max(stock, metrics.reorderPoint, metrics.safetyStock, 1) * 1.2;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-secondary text-secondary-foreground">
              {features.skuCode}
            </span>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{features.name}</h1>
            {features.isActive ? (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                <CheckCircle2 className="h-3 w-3" /> Actif
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                Inactif
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Séries temporelles de la demande historique et modèle prédictif à 30 jours (Incertitude
            90 %).{" "}
            {metrics.computeMs > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                calculé en {metrics.computeMs} ms
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Sélectionner SKU
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary min-w-[280px]"
          >
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sku_code} — {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Inactive SKU warning ───────────────────────────────────────────── */}
      {!features.isActive && (
        <div className="mb-6 p-4 rounded-xl border border-warning/40 bg-warning/10 text-warning flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>SKU inactif</strong> — aucun stock ni historique de demande détecté. Les
            prévisions affichées sont basées sur des valeurs par défaut et ne reflètent pas de
            données réelles.
          </div>
        </div>
      )}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi
          label="Demande moy. jour"
          value={`${metrics.avgDailyDemand.toFixed(2)} u/j`}
          color="text-primary"
        />
        <Kpi
          label="Prévision 30j (MOQ)"
          value={`${metrics.forecast30d} u`}
          color="text-primary-glow"
          hint={features.moq > 0 ? `MOQ ${features.moq}` : undefined}
        />
        <Kpi label="Stock de Sécurité" value={`${metrics.safetyStock} u`} color="text-warning" />
        <Kpi
          label="Point de Commande"
          value={`${metrics.reorderPoint} u`}
          color="text-destructive"
        />
      </div>

      {/* ── Main chart + stock panel ───────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary" /> Modèle prédictif : Historique vs
            Prévision IA
          </h2>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={10} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--foreground)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="hi"
                stroke="none"
                fill="var(--primary)"
                fillOpacity={0.15}
                name="Incertitude haute"
              />
              <Area type="monotone" dataKey="lo" stroke="none" fill="var(--card)" fillOpacity={1} />
              <Line
                type="monotone"
                dataKey="hist"
                stroke="var(--foreground)"
                strokeWidth={2}
                dot={false}
                name="Historique"
              />
              <Line
                type="monotone"
                dataKey="fc"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Prévision IA"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Stock vs thresholds */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 uppercase tracking-wider text-muted-foreground">
            Niveau de stock vs seuils
          </h2>
          <div className="space-y-4">
            <Bar label="Stock Physique" value={stock} max={maxBar} color="bg-success" />
            <Bar
              label="Stock de Sécurité"
              value={metrics.safetyStock}
              max={maxBar}
              color="bg-warning"
            />
            <Bar
              label="Point de Commande"
              value={metrics.reorderPoint}
              max={maxBar}
              color="bg-destructive"
            />
          </div>

          {/* Status */}
          <div className="mt-5 p-3 rounded-xl border border-chart-5/40 bg-chart-5/10 text-chart-5 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Statut :</strong>{" "}
              {metrics.status === "critical"
                ? "Critique — Rupture imminente"
                : metrics.status === "low"
                  ? "Réappro recommandé"
                  : metrics.status === "overstock"
                    ? "Surstockage : capital immobilisé"
                    : "Optimal"}
            </div>
          </div>

          {/* Recommended order */}
          {metrics.recommendedOrder > 0 && (
            <div className="mt-3 p-3 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs flex items-start gap-2">
              <Zap className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Commande recommandée :</strong> {metrics.recommendedOrder} u
                {features.moq > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">(MOQ {features.moq})</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SKU Constraints panel ─────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <Package className="h-4 w-4 text-primary" /> Contraintes SKU (Gestion SKUs)
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <SkuField label="MOQ" value={features.moq > 0 ? `${features.moq} u` : "Non défini"} />
            <SkuField label="Délai fournisseur" value={`${features.leadTimeDays} j`} />
            <SkuField
              label="Niveau de service"
              value={`${(features.serviceLevel * 100).toFixed(1)} %`}
            />
            <SkuField
              label="Coût unitaire"
              value={features.unitCost > 0 ? `${features.unitCost.toFixed(2)} €` : "—"}
            />
            <SkuField
              label="Stock min (manuel)"
              value={features.minStock != null ? `${features.minStock} u` : "—"}
            />
            <SkuField
              label="Stock max (manuel)"
              value={features.maxStock != null ? `${features.maxStock} u` : "—"}
            />
            <SkuField
              label="Min IA recommandé"
              value={features.aiMinRecommended != null ? `${features.aiMinRecommended} u` : "—"}
            />
            <SkuField
              label="Max IA recommandé"
              value={features.aiMaxRecommended != null ? `${features.aiMaxRecommended} u` : "—"}
            />
          </div>

          {/* Constraints met indicator */}
          <div
            className={`mt-4 p-3 rounded-xl border text-xs flex items-center gap-2 ${
              metrics.constraintsMet
                ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}
          >
            {metrics.constraintsMet ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
            )}
            <span>
              <strong>Contraintes :</strong>{" "}
              {metrics.constraintsMet
                ? "Toutes les contraintes sont respectées"
                : "Stock insuffisant ou hors limites configurées"}
            </span>
          </div>
        </div>

        {/* Inventory summary */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <BarChart2 className="h-4 w-4 text-primary" /> Inventaire & Pipeline
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <SkuField label="Stock physique" value={`${features.stock} u`} />
            <SkuField label="En commande" value={`${features.onOrder} u`} />
            <SkuField label="En production" value={`${features.inProduction} u`} />
            <SkuField label="Inventaire projeté" value={`${metrics.projectedInventory} u`} />
            <SkuField
              label="Couverture (jours)"
              value={metrics.daysOfCover >= 999 ? "∞" : `${metrics.daysOfCover} j`}
            />
            <SkuField
              label="Valeur stock"
              value={
                features.unitCost > 0 ? `${(features.stock * features.unitCost).toFixed(0)} €` : "—"
              }
            />
          </div>
        </div>
      </div>

      {/* ── 7-day forecast detail ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-bold mb-4 flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Clock className="h-4 w-4 text-primary" /> Prochaines échéances (Prévisions journalières
          7j)
        </h2>
        <div className="grid grid-cols-7 gap-2">
          {series
            .filter((p) => p.fc != null)
            .slice(0, 7)
            .map((p) => (
              <div
                key={p.d}
                className="rounded-xl border border-border bg-background p-3 text-center"
              >
                <div className="text-[10px] text-muted-foreground font-mono">{p.d}</div>
                <div className="text-base font-bold text-primary mt-1">{p.fc} u</div>
                <div className="text-[9px] text-muted-foreground font-mono">
                  ±{(p.hi ?? p.fc ?? 0) - (p.fc ?? 0)}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      {hint && (
        <div className="text-[10px] text-muted-foreground font-mono mt-1 opacity-70">{hint}</div>
      )}
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-bold">
          {label} ({value} u)
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SkuField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div className="text-sm font-mono font-bold text-foreground">{value}</div>
    </div>
  );
}
