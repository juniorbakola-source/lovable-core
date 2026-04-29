import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize } from "@/lib/optimizer";
import { Boxes, AlertTriangle, TrendingUp, DollarSign } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Overview — FlowStock Pro" }] }),
  component: Overview,
});

function Overview() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("skus").select("*").then(({ data }) => {
      setSkus(data ?? []);
      setLoading(false);
    });
  }, []);

  const enriched = skus.map((s) => ({ ...s, opt: optimize(s) }));
  const total = enriched.length;
  const toReorder = enriched.filter((s) => s.opt.recommendedOrder > 0).length;
  const critical = enriched.filter((s) => s.opt.status === "critical").length;
  const inventoryValue = enriched.reduce((acc, s) => acc + s.opt.inventoryValue, 0);

  const chartData = enriched.slice(0, 10).map((s) => ({
    name: s.sku_code,
    stock: s.stock,
    reorder: s.opt.reorderPoint,
  }));

  const stats = [
    { label: "Active SKUs", value: total, icon: Boxes, color: "from-primary to-primary-glow" },
    { label: "To reorder", value: toReorder, icon: TrendingUp, color: "from-warning to-warning" },
    { label: "Critical", value: critical, icon: AlertTriangle, color: "from-destructive to-destructive" },
    { label: "Inventory value", value: `$${inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "from-success to-success" },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">Real-time view of your inventory health.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center mb-3`}>
              <s.icon className="h-5 w-5 text-white" />
            </div>
            <div className="text-2xl font-bold">{loading ? "—" : s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">Stock vs reorder point</h2>
        <p className="text-sm text-muted-foreground mb-6">Top 10 SKUs — bars below the orange line need attention.</p>
        {loading ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
            <Boxes className="h-10 w-10 mb-2 opacity-50" />
            No SKUs yet — add one from the SKUs page.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 255)" />
              <XAxis dataKey="name" stroke="oklch(0.5 0.03 255)" fontSize={12} />
              <YAxis stroke="oklch(0.5 0.03 255)" fontSize={12} />
              <Tooltip contentStyle={{ background: "white", border: "1px solid oklch(0.92 0.01 255)", borderRadius: 8 }} />
              <Bar dataKey="stock" fill="oklch(0.52 0.22 270)" radius={[6, 6, 0, 0]} name="Current stock" />
              <Bar dataKey="reorder" fill="oklch(0.75 0.17 75)" radius={[6, 6, 0, 0]} name="Reorder point" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
