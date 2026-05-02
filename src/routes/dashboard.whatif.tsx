import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize, zScore } from "@/lib/optimizer";
import { toSkuInput, safeNum } from "@/lib/sku-helpers";
import type { Database } from "@/integrations/supabase/types";
import { Sliders } from "lucide-react";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/whatif")({
  head: () => ({ meta: [{ title: "Analyse What-If — FlowStockAI" }] }),
  component: WhatIfPage,
});

function WhatIfPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [serviceLevel, setServiceLevel] = useState(0.95);
  const [leadTime, setLeadTime] = useState(7);
  const [demandMultiplier, setDemandMultiplier] = useState(1);

  useEffect(() => {
    supabase.from("skus").select("*").order("sku_code").then(({ data }) => {
      const list = (data as Sku[] | null) ?? [];
      setSkus(list);
      if (list[0]) {
        setSelected(list[0].id);
        setServiceLevel(safeNum(list[0].service_level, 0.95));
        setLeadTime(safeNum(list[0].lead_time_days, 7));
      }
    });
  }, []);

  const sku = skus.find((s) => s.id === selected);

  const baseline = useMemo(() => sku ? optimize(toSkuInput(sku)) : null, [sku]);
  const simulated = useMemo(() => {
    if (!sku) return null;
    const input = toSkuInput(sku);
    const adjusted = {
      ...input,
      service_level: serviceLevel,
      lead_time_days: leadTime,
      demand_history: input.demand_history.map((v) => Number(v) * demandMultiplier),
    };
    return optimize(adjusted);
  }, [sku, serviceLevel, leadTime, demandMultiplier]);

  if (!sku || !baseline || !simulated) {
    return <div className="p-8 text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sliders className="h-6 w-6 text-primary" /> Analyse What-If
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simule l'impact de changements de paramètres sur ton stock optimal.
        </p>
      </div>

      <div className="mb-6">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">SKU à simuler</label>
        <select
          value={selected}
          onChange={(e) => {
            const s = skus.find((x) => x.id === e.target.value);
            setSelected(e.target.value);
            if (s) {
              setServiceLevel(safeNum(s.service_level, 0.95));
              setLeadTime(safeNum(s.lead_time_days, 7));
              setDemandMultiplier(1);
            }
          }}
          className="mt-1 w-full md:w-[400px] bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono"
        >
          {skus.map((s) => (
            <option key={s.id} value={s.id}>{s.sku_code} — {s.name}</option>
          ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Paramètres</h2>
          <SliderRow label="Niveau de service" value={serviceLevel} min={0.9} max={0.99} step={0.01} onChange={setServiceLevel} display={`${(serviceLevel * 100).toFixed(0)}% (z=${zScore(serviceLevel).toFixed(2)})`} />
          <SliderRow label="Délai de livraison (jours)" value={leadTime} min={1} max={90} step={1} onChange={setLeadTime} display={`${leadTime} jours`} />
          <SliderRow label="Variation de la demande" value={demandMultiplier} min={0.5} max={2} step={0.1} onChange={setDemandMultiplier} display={`× ${demandMultiplier.toFixed(1)}`} />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Impact</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-3">Métrique</th>
                <th className="pb-3 text-right">Baseline</th>
                <th className="pb-3 text-right text-primary">Simulé</th>
                <th className="pb-3 text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <CompareRow label="Stock de sécurité" base={baseline.safetyStock} sim={simulated.safetyStock} unit="u" />
              <CompareRow label="Point de commande" base={baseline.reorderPoint} sim={simulated.reorderPoint} unit="u" />
              <CompareRow label="Commande recommandée" base={baseline.recommendedOrder} sim={simulated.recommendedOrder} unit="u" />
              <CompareRow label="Jours de couverture" base={baseline.daysOfCover} sim={simulated.daysOfCover} unit="j" />
              <CompareRow
                label="Investissement requis"
                base={Math.round(baseline.recommendedOrder * safeNum(sku.unit_cost))}
                sim={Math.round(simulated.recommendedOrder * safeNum(sku.unit_cost))}
                unit="€"
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-2">
        <span className="font-bold">{label}</span>
        <span className="font-mono text-primary">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

function CompareRow({ label, base, sim, unit }: { label: string; base: number; sim: number; unit: string }) {
  const delta = sim - base;
  const sign = delta > 0 ? "+" : "";
  const color = delta > 0 ? "text-warning" : delta < 0 ? "text-success" : "text-muted-foreground";
  return (
    <tr className="border-t border-border">
      <td className="py-2.5 text-foreground/80 font-sans text-xs">{label}</td>
      <td className="py-2.5 text-right text-muted-foreground">{base.toLocaleString("fr-FR")} {unit}</td>
      <td className="py-2.5 text-right text-primary font-bold">{sim.toLocaleString("fr-FR")} {unit}</td>
      <td className={`py-2.5 text-right ${color} font-bold`}>{sign}{delta.toLocaleString("fr-FR")}</td>
    </tr>
  );
}
