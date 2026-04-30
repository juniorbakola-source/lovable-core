import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize } from "@/lib/optimizer";
import type { Database } from "@/integrations/supabase/types";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";
import { TrendingUp, Package, AlertCircle, DollarSign } from "lucide-react";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/analytics")({
  head: () => ({ meta: [{ title: "Analytics — FlowStock Pro" }] }),
  component: AnalyticsPage,
});

const COLORS = ["oklch(0.62 0.18 155)", "oklch(0.75 0.17 75)", "oklch(0.6 0.24 27)", "oklch(0.5 0.03 255)"];

function AnalyticsPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("skus").select("*").then(({ data }) => {
      setSkus(data ?? []);
      setLoading(false);
    });
  }, []);

  const { statusData, valueByCategory, demandTrend, topMovers, totals } = useMemo(() => {
    const enriched = skus.map((s) => ({ ...s, opt: optimize(s) }));

    const statusCounts = { ok: 0, low: 0, critical: 0, overstock: 0 };
    enriched.forEach((s) => statusCounts[s.opt.status]++);
    const statusData = [
      { name: "Healthy", value: statusCounts.ok },
      { name: "Reorder", value: statusCounts.low },
      { name: "Critical", value: statusCounts.critical },
      { name: "Overstock", value: statusCounts.overstock },
    ].filter((d) => d.value > 0);

    const catMap = new Map<string, number>();
    enriched.forEach((s) => {
      const k = s.category || "Uncategorized";
      catMap.set(k, (catMap.get(k) ?? 0) + s.opt.inventoryValue);
    });
    const valueByCategory = Array.from(catMap.entries()).map(([name, value]) => ({
      name, value: Math.round(value),
    }));

    const maxLen = Math.max(0, ...enriched.map((s) => s.demand_history.length));
    const demandTrend = Array.from({ length: maxLen }, (_, i) => {
      const day = i + 1;
      const total = enriched.reduce((acc, s) => acc + (s.demand_history[i] ?? 0), 0);
      return { day: `D${day}`, demand: total };
    });

    const topMovers = [...enriched]
      .sort((a, b) => b.opt.avgDailyDemand - a.opt.avgDailyDemand)
      .slice(0, 8)
      .map((s) => ({ name: s.sku_code, demand: Number(s.opt.avgDailyDemand.toFixed(1)) }));

    const totals = {
      skus: enriched.length,
      totalDemand: enriched.reduce((a, s) => a + s.opt.avgDailyDemand, 0),
      avgCover: enriched.length
        ? enriched.reduce((a, s) => a + Math.min(s.opt.daysOfCover, 365), 0) / enriched.length
        : 0,
      value: enriched.reduce((a, s) => a + s.opt.inventoryValue, 0),
    };

    return { statusData, valueByCategory, demandTrend, topMovers, totals };
  }, [skus]);

  const kpis = [
    { label: "Total SKUs", value: totals.skus, icon: Package },
    { label: "Daily demand (units)", value: totals.totalDemand.toFixed(0), icon: TrendingUp },
    { label: "Avg days of cover", value: totals.avgCover.toFixed(0), icon: AlertCircle },
    { label: "Total value", value: `$${totals.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1">Deep insights across your inventory portfolio.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-5">
            <k.icon className="h-5 w-5 text-primary mb-3" />
            <div className="text-2xl font-bold">{loading ? "—" : k.value}</div>
            <div className="text-sm text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <Card title="Inventory health" subtitle="Distribution of SKU statuses">
          {statusData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {statusData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Value by category" subtitle="Inventory $ allocation">
          {valueByCategory.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={valueByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 255)" />
                <XAxis dataKey="name" stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <YAxis stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" fill="oklch(0.52 0.22 270)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Aggregate demand trend" subtitle="Sum of daily demand across all SKUs">
          {demandTrend.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={demandTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 255)" />
                <XAxis dataKey="day" stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <YAxis stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="demand" stroke="oklch(0.52 0.22 270)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Top movers" subtitle="Highest average daily demand">
          {topMovers.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topMovers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 255)" />
                <XAxis type="number" stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <YAxis dataKey="name" type="category" stroke="oklch(0.5 0.03 255)" fontSize={12} width={80} />
                <Tooltip />
                <Bar dataKey="demand" fill="oklch(0.65 0.24 285)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">No data yet.</div>;
}
