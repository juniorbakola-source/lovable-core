import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize } from "@/lib/optimizer";
import { toSkuInput, safeNum } from "@/lib/sku-helpers";
import { seedDemoData } from "@/lib/demo-seed";
import {
  Boxes,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Sparkles,
  Truck,
  ShoppingCart,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Vue Globale — FlowStockAI" }] }),
  component: Overview,
});

function Overview() {
  const { user } = useAuth();
  const { fc, t } = useLocale();
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("skus").select("*");
    setSkus((data as Sku[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSeed() {
    if (!user) return;
    setSeeding(true);
    try {
      const { inserted } = await seedDemoData(user.id);
      toast.success(`${inserted} SKUs de démo créés`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setSeeding(false);
    }
  }

  const enriched = useMemo(() => skus.map((s) => ({ ...s, opt: optimize(toSkuInput(s)) })), [skus]);
  const total = enriched.length;
  const critical = enriched.filter((s) => s.opt.status === "critical").length;
  const toReorder = enriched.filter((s) => s.opt.recommendedOrder > 0).length;
  const inventoryValue = enriched.reduce((acc, s) => acc + s.opt.inventoryValue, 0);
  const monthlyHolding = enriched.reduce(
    (acc, s) => acc + safeNum(s.stock) * safeNum(s.unit_cost) * 0.02,
    0,
  );
  const monthlyShortage = enriched
    .filter((s) => s.opt.status === "critical" || s.opt.status === "low")
    .reduce((acc, s) => acc + s.opt.recommendedOrder * safeNum(s.unit_cost) * 0.15, 0);

  const opt = enriched.filter((s) => s.opt.status === "ok").length;
  const reappro = enriched.filter((s) => s.opt.status === "low").length;
  const alert = enriched.filter((s) => s.opt.status === "critical").length;
  const surstock = enriched.filter((s) => s.opt.status === "overstock").length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const urgent = enriched
    .filter((s) => s.opt.recommendedOrder > 0)
    .sort(
      (a, b) =>
        b.opt.recommendedOrder * safeNum(b.unit_cost) -
        a.opt.recommendedOrder * safeNum(a.unit_cost),
    )
    .slice(0, 3);

  const chartData = enriched.slice(0, 10).map((s) => ({
    name: s.sku_code ?? "",
    stock: safeNum(s.stock),
    rop: s.opt.reorderPoint,
  }));

  if (!loading && total === 0) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Sparkles className="h-12 w-12 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Bienvenue sur FlowStockAI</h1>
          <p className="text-muted-foreground mb-6">
            Aucun SKU pour l'instant. Charge un jeu de démo (10 SKUs avec 12 mois d'historique IA)
            pour explorer la plateforme.
          </p>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold text-sm hover:shadow-[var(--shadow-elegant)] transition-all disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />{" "}
            {seeding ? "Génération…" : "Charger les données de démo"}
          </button>
          <div className="mt-6 text-xs text-muted-foreground">
            Ou{" "}
            <Link to="/dashboard/skus" className="text-primary underline">
              crée tes SKUs manuellement
            </Link>
            .
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{t("overview.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("overview.subtitle")}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-mono font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Flux Synchro Temps Réel
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label={t("overview.total_value")}
          value={fc(inventoryValue)}
          sub="Valorisation au coût d'achat"
          icon={DollarSign}
          tone="default"
          to={{ to: "/dashboard/skus" as const, search: {} }}
          loading={loading}
        />
        <KpiCard
          label="Risques ruptures (Urgent)"
          value={`${critical} SKUs`}
          sub="Stock < 50% de sécurité"
          icon={AlertTriangle}
          tone="danger"
          to={{ to: "/dashboard/skus" as const, search: { status: "critical" } }}
          loading={loading}
        />
        <KpiCard
          label="Commandes recommandées"
          value={`${toReorder} SKUs`}
          sub="Point de commande dépassé"
          icon={Boxes}
          tone="warning"
          to={{ to: "/dashboard/solver" as const, search: {} }}
          loading={loading}
        />
        <KpiCard
          label="Commandes en cours (PO)"
          value="0 active"
          sub="En attente ou transit"
          icon={Truck}
          tone="info"
          to={{ to: "/dashboard/pos" as const, search: {} }}
          loading={loading}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-bold mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Santé du Catalogue Stock ({total} SKUs)
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Distribution des statuts d'optimisation.
          </p>
          <div className="flex h-3 rounded-full overflow-hidden mb-4 border border-border">
            {opt > 0 && <div style={{ width: `${pct(opt)}%` }} className="bg-success" />}
            {reappro > 0 && <div style={{ width: `${pct(reappro)}%` }} className="bg-warning" />}
            {alert > 0 && <div style={{ width: `${pct(alert)}%` }} className="bg-destructive" />}
            {surstock > 0 && <div style={{ width: `${pct(surstock)}%` }} className="bg-chart-5" />}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <LegendItem color="success" label="Optimal" pct={pct(opt)} />
            <LegendItem color="warning" label="Réappro" pct={pct(reappro)} />
            <LegendItem color="destructive" label="Alerte Rupture" pct={pct(alert)} />
            <LegendItem color="chart-5" label="Surstock" pct={pct(surstock)} />
          </div>
          <div className="mt-5 pt-4 border-t border-border space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coût total de possession / mois :</span>
              <span className="font-mono font-bold text-warning">
                {fc(monthlyHolding)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coût de rupture estimé / mois :</span>
              <span className="font-mono font-bold text-destructive">
                {fc(monthlyShortage)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Recommandations Moteur IA
            </h2>
            <div className="flex gap-3">
              <Link
                to="/dashboard/silvery"
                className="text-xs text-primary font-bold hover:underline"
              >
                Silvery Engine →
              </Link>
              <Link
                to="/dashboard/solver"
                className="text-xs text-primary font-bold hover:underline"
              >
                Solveur →
              </Link>
            </div>
          </div>
          {urgent.length === 0 ? (
            <div className="text-center text-muted-foreground text-xs py-8">
              Aucune action urgente. Tous tes SKUs sont au vert.
            </div>
          ) : (
            <div className="space-y-3">
              {urgent.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-background/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {s.sku_code}
                      </span>
                      <span className="text-xs font-medium truncate">{s.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      Stock: {safeNum(s.stock)} u | ROP: {s.opt.reorderPoint} u | Invest:{" "}
                      {fc(s.opt.recommendedOrder * safeNum(s.unit_cost))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Recommandé</div>
                    <div className="text-sm font-bold text-primary">
                      +{s.opt.recommendedOrder} u
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-bold mb-1">Stock vs Point de commande</h2>
        <p className="text-xs text-muted-foreground mb-6">
          Top 10 SKUs — clique sur une barre pour inspecter.
        </p>
        {chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Chargement…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--foreground)",
                }}
              />
              <Bar
                dataKey="stock"
                fill="var(--primary)"
                radius={[6, 6, 0, 0]}
                name="Stock actuel"
              />
              <Bar dataKey="rop" fill="var(--warning)" radius={[6, 6, 0, 0]} name="ROP" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  to,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Boxes;
  tone: "default" | "danger" | "warning" | "info";
  to: { to: string; search: Record<string, unknown> };
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
  const iconColor =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <Link
      {...to}
      className={`block rounded-2xl border ${ring} bg-card p-4 hover:border-primary/60 hover:shadow-[var(--shadow-elegant)] transition-all`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
          {label}
        </div>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="text-2xl font-bold mb-1">{loading ? "—" : value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </Link>
  );
}

function LegendItem({ color, label, pct }: { color: string; label: string; pct: number }) {
  const bg =
    color === "success"
      ? "bg-success"
      : color === "warning"
        ? "bg-warning"
        : color === "destructive"
          ? "bg-destructive"
          : "bg-chart-5";
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border">
      <span className={`h-2 w-2 rounded-full ${bg}`} />
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="ml-auto font-mono text-muted-foreground">{pct}%</span>
    </div>
  );
}

void ShoppingCart;
