import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("skus").select("*").then(({ data }) => {
      setSkus((data as Sku[] | null) ?? []);
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

  const goToSkus = (filter?: Record<string, string>) =>
    navigate({ to: "/dashboard/skus", search: filter });

  const stats = [
    { label: "Active SKUs", value: total, icon: Boxes, color: "from-primary to-primary-glow", filter: undefined },
    { label: "To reorder", value: toReorder, icon: TrendingUp, color: "from-warning to-warning", filter: { reorder: "1" } },
    { label: "Critical", value: critical, icon: AlertTriangle, color: "from-destructive to-destructive", filter: { status: "critical" } },
    { label: "Inventory value", value: `$${inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "from-success to-success", filter: undefined },
  ] as const;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">Real-time view of your inventory health. Click any card or bar to drill down.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <button
            key={s.label}
            onClick={() => goToSkus(s.filter)}
            className="text-left rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:shadow-[var(--shadow-elegant)] transition-all"
          >
            <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center mb-3`}>
              <s.icon className="h-5 w-5 text-white" />
            </div>
            <div className="text-2xl font-bold">{loading ? "—" : s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">Stock vs reorder point</h2>
        <p className="text-sm text-muted-foreground mb-6">Top 10 SKUs — click a bar to inspect that SKU.</p>
        {loading ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
            <Boxes className="h-10 w-10 mb-2 opacity-50" />
            No SKUs yet — add one from the SKUs page.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} onClick={(e) => {
              const code = ((e as { activePayload?: { payload?: { name?: string } }[] })?.activePayload?.[0]?.payload?.name) as string | undefined;
              if (code) goToSkus({ q: code });
            }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 255)" />
              <XAxis dataKey="name" stroke="oklch(0.5 0.03 255)" fontSize={12} />
              <YAxis stroke="oklch(0.5 0.03 255)" fontSize={12} />
              <Tooltip contentStyle={{ background: "white", border: "1px solid oklch(0.92 0.01 255)", borderRadius: 8 }} />
              <Bar dataKey="stock" fill="oklch(0.52 0.22 270)" radius={[6, 6, 0, 0]} name="Current stock" cursor="pointer" />
              <Bar dataKey="reorder" fill="oklch(0.75 0.17 75)" radius={[6, 6, 0, 0]} name="Reorder point" cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
