import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize } from "@/lib/optimizer";
import type { Database } from "@/integrations/supabase/types";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { TrendingUp, AlertCircle } from "lucide-react";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/forecasting")({
  head: () => ({ meta: [{ title: "Séries Temporelles IA — FlowStockAI" }] }),
  component: ForecastingPage,
});

function ForecastingPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("skus").select("*").order("sku_code").then(({ data }) => {
      const list = (data as Sku[] | null) ?? [];
      setSkus(list);
      if (list[0]) setSelected(list[0].id);
      setLoading(false);
    });
  }, []);

  const sku = skus.find((s) => s.id === selected);

  const series = useMemo(() => {
    if (!sku) return [];
    const yearly = sku.demand_history_yearly ?? [];
    const recent = sku.demand_history ?? [];
    const forecast = sku.forecast_3m ?? [];

    // Build daily-ish series: last 20 days from `recent` then 30 days forecast
    const points: Array<{ d: string; hist?: number; fc?: number; lo?: number; hi?: number }> = [];
    const today = new Date();
    const histDays = recent.length;
    for (let i = histDays - 1; i >= 0; i--) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - (i + 1));
      points.push({
        d: dt.toISOString().slice(5, 10),
        hist: Number(recent[histDays - 1 - i]),
      });
    }
    // Forecast next 30 days based on first month of forecast_3m
    const fcMonthly = forecast[0] ?? yearly[yearly.length - 1] ?? 0;
    const dailyFc = Number(fcMonthly) / 30;
    const sigma = Math.max(1, dailyFc * 0.25);
    for (let i = 1; i <= 30; i++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() + i);
      const fc = Math.round(dailyFc * (1 + Math.sin(i / 6) * 0.05));
      const widening = 1 + i / 30;
      points.push({
        d: dt.toISOString().slice(5, 10),
        fc,
        lo: Math.max(0, Math.round(fc - 1.65 * sigma * widening)),
        hi: Math.round(fc + 1.65 * sigma * widening),
      });
    }
    return points;
  }, [sku]);

  if (!loading && skus.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Aucun SKU. Charge des données pour voir les séries temporelles.
      </div>
    );
  }

  if (!sku) return <div className="p-8 text-muted-foreground">Chargement…</div>;

  const opt = optimize(sku);
  const forecast30 = Math.round(opt.avgDailyDemand * 30);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-secondary text-secondary-foreground">
              {sku.sku_code}
            </span>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{sku.name}</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Séries temporelles de la demande historique et modèle prédictif à 30 jours (Incertitude 90%).
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Sélectionner SKU</label>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Moyenne Demand Jour" value={`${opt.avgDailyDemand.toFixed(2)} u/j`} color="text-primary" />
        <Kpi label="Prévision Mois (30j)" value={`${forecast30} u`} color="text-primary-glow" />
        <Kpi label="Stock de Sécurité (SS)" value={`${opt.safetyStock} u`} color="text-warning" />
        <Kpi label="Point de Commande (ROP)" value={`${opt.reorderPoint} u`} color="text-destructive" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary" /> Modèle prédictif : Historique vs Prévision IA
          </h2>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={10} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="hi" stroke="none" fill="var(--primary)" fillOpacity={0.15} name="Incertitude haute" />
              <Area type="monotone" dataKey="lo" stroke="none" fill="var(--card)" fillOpacity={1} />
              <Line type="monotone" dataKey="hist" stroke="var(--foreground)" strokeWidth={2} dot={false} name="Historique" />
              <Line type="monotone" dataKey="fc" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Prévision IA" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold mb-4 uppercase tracking-wider text-muted-foreground">
            Niveau de stock vs seuils
          </h2>
          <div className="space-y-4">
            <Bar label="Stock Physique" value={sku.stock} max={Math.max(sku.stock, opt.reorderPoint, opt.safetyStock) * 1.2} color="bg-success" />
            <Bar label="Stock de Sécurité" value={opt.safetyStock} max={Math.max(sku.stock, opt.reorderPoint, opt.safetyStock) * 1.2} color="bg-warning" />
            <Bar label="Point de Commande" value={opt.reorderPoint} max={Math.max(sku.stock, opt.reorderPoint, opt.safetyStock) * 1.2} color="bg-destructive" />
          </div>
          <div className="mt-5 p-3 rounded-xl border border-chart-5/40 bg-chart-5/10 text-chart-5 text-xs flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Statut :</strong>{" "}
              {opt.status === "critical" ? "Critique — Rupture imminente" :
                opt.status === "low" ? "Réappro recommandé" :
                opt.status === "overstock" ? "Surstockage : capital immobilisé" : "Optimal"}
            </div>
          </div>
        </div>
      </div>

      {/* 7-day forecast cards */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-sm font-bold mb-4 uppercase tracking-wider text-muted-foreground">
          Prochaines échéances (Prévisions journalières 7j)
        </h2>
        <div className="grid grid-cols-7 gap-2">
          {series.filter((p) => p.fc != null).slice(0, 7).map((p) => (
            <div key={p.d} className="rounded-xl border border-border bg-background p-3 text-center">
              <div className="text-[10px] text-muted-foreground font-mono">{p.d}</div>
              <div className="text-base font-bold text-primary mt-1">{p.fc} u</div>
              <div className="text-[9px] text-muted-foreground font-mono">±{p.hi! - p.fc!}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-bold">{label} ({value} u)</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
