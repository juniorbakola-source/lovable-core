import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize } from "@/lib/optimizer";
import { toSkuInput, safeNum } from "@/lib/sku-helpers";
import type { Database } from "@/integrations/supabase/types";
import { Cpu, ShoppingCart, AlertTriangle, CheckCircle2, Package, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/solver")({
  head: () => ({ meta: [{ title: "Solveur Engine — FlowStockAI" }] }),
  component: SolverPage,
});

type StatusKey = "Optimal" | "Réappro" | "Rupture" | "Surstock";

function statusFor(opt: ReturnType<typeof optimize>): StatusKey {
  if (opt.status === "critical") return "Rupture";
  if (opt.status === "low") return "Réappro";
  if (opt.status === "overstock") return "Surstock";
  return "Optimal";
}

/**
 * Returns the most actionable reason why a SKU with "Rupture" status
 * has no recommended order quantity (recommendedOrder === 0).
 */
export function ruptureNoOrderReason(sku: Sku): string {
  const input = toSkuInput(sku);
  const opt = optimize(input);

  // Only meaningful for Rupture + no recommendation
  if (opt.recommendedOrder > 0 || opt.status !== "critical") return "";

  const avgDaily = opt.avgDailyDemand;

  // Case 1: No demand history → demand = 0
  if (avgDaily === 0) {
    return (
      "Aucune demande historique enregistrée pour ce SKU. " +
      "Le moteur ne peut pas calculer de besoin sans historique de ventes. " +
      "Action : renseigner l'historique de demande dans la fiche SKU."
    );
  }

  const onOrder = safeNum(sku.on_order);
  const projectedInventory = opt.projectedInventory;

  // Case 2: on_order (transit) already covers the reorder point
  if (onOrder > 0 && projectedInventory >= opt.reorderPoint) {
    return (
      `Stock physique bas (${safeNum(sku.stock)} u ≤ stock de sécurité ${opt.safetyStock} u), ` +
      `mais ${onOrder} u déjà en commande (transit) couvrent la demande projetée. ` +
      `Inventaire projeté : ${projectedInventory} u ≥ ROP ${opt.reorderPoint} u. ` +
      "Aucune commande supplémentaire n'est nécessaire — attendre la réception."
    );
  }

  // Case 3: Projected inventory covers the 30-day target
  const targetCover = Math.round(avgDaily * 30);
  if (projectedInventory >= targetCover) {
    return (
      `Le stock combiné (physique + transit = ${projectedInventory} u) couvre déjà ` +
      `l'objectif 30 jours (${targetCover} u). Aucune commande n'est déclenchée ` +
      "même si le stock physique seul est sous le stock de sécurité."
    );
  }

  // Case 4: MOQ too high — order would be rounded to 0
  if (safeNum(sku.moq) > 0 && opt.projectedInventory < opt.reorderPoint) {
    return (
      `La MOQ (${safeNum(sku.moq)} u) ou les contraintes d'arrondi ont ramené ` +
      "la recommande à 0. Vérifiez la valeur de la MOQ dans la fiche SKU."
    );
  }

  return (
    "Le moteur n'a pas déclenché de recommande pour ce SKU malgré le statut Rupture. " +
    "Vérifiez l'historique de demande, le délai fournisseur et les commandes en cours."
  );
}

const STATUS_STYLES: Record<StatusKey, { badge: string; icon: typeof Cpu }> = {
  Optimal: { badge: "bg-success/15 text-success border-success/30", icon: CheckCircle2 },
  Réappro: { badge: "bg-warning/15 text-warning border-warning/30", icon: ShoppingCart },
  Rupture: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    icon: AlertTriangle,
  },
  Surstock: { badge: "bg-chart-5/15 text-chart-5 border-chart-5/30", icon: Package },
};

function SolverPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("skus").select("*").order("sku_code");
    if (error) toast.error(error.message);
    setSkus((data as Sku[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(
    () =>
      skus.map((s) => {
        const opt = optimize(toSkuInput(s));
        return { ...s, opt, statusKey: statusFor(opt) };
      }),
    [skus],
  );

  const recommended = rows.filter((r) => r.opt.recommendedOrder > 0);

  async function createAllPOs() {
    if (recommended.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    setCreating(true);
    try {
      const inserts = recommended.map((r) => ({
        user_id: uid,
        sku_id: r.id,
        po_number: `PO-${Date.now()}-${r.sku_code ?? ""}`,
        quantity: r.opt.recommendedOrder,
        unit_cost: safeNum(r.unit_cost),
        status: "draft" as const,
        ordered_at: new Date().toISOString(),
        expected_at: new Date(Date.now() + safeNum(r.lead_time_days, 30) * 86400000).toISOString(),
      }));
      const { error } = await supabase.from("purchase_orders").insert(inserts);
      if (error) throw error;
      toast.success(`${inserts.length} bons de commande créés en brouillon`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" /> Supply Optimization Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Matrice de réapprovisionnement automatique calculée par le solveur.
          </p>
        </div>
        <button
          onClick={createAllPOs}
          disabled={creating || recommended.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold text-sm hover:shadow-[var(--shadow-elegant)] transition-all disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          {creating ? "Création…" : `Commander Tous Recommandés (${recommended.length})`}
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/40">
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-3">SKU</th>
                <th className="px-3 py-3">Nom</th>
                <th className="px-3 py-3">Prévision (30j)</th>
                <th className="px-3 py-3">Sécurité (SS)</th>
                <th className="px-3 py-3">Seuil ROP</th>
                <th className="px-3 py-3">Stock Réel</th>
                <th className="px-3 py-3">Transit</th>
                <th className="px-3 py-3">Statut IA</th>
                <th className="px-3 py-3">Rupture €</th>
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
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    Aucun SKU.{" "}
                    <Link to="/dashboard" className="text-primary underline">
                      Charge la démo
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const st = STATUS_STYLES[r.statusKey];
                  const Icon = st.icon;
                  const forecast30 = Math.round(r.opt.avgDailyDemand * 30);
                  const ruptureCost =
                    r.statusKey === "Rupture"
                      ? r.opt.recommendedOrder * safeNum(r.unit_cost) * 0.15
                      : 0;
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-3 font-mono font-bold">{r.sku_code}</td>
                      <td className="px-3 py-3 max-w-[160px] truncate">{r.name}</td>
                      <td className="px-3 py-3 text-muted-foreground">{forecast30} u</td>
                      <td className="px-3 py-3 text-warning">{r.opt.safetyStock} u</td>
                      <td className="px-3 py-3 text-destructive">{r.opt.reorderPoint} u</td>
                      <td className="px-3 py-3 font-bold">{safeNum(r.stock)} u</td>
                      <td className="px-3 py-3 text-primary">
                        {safeNum(r.on_order) > 0 ? `+${safeNum(r.on_order)}` : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold",
                            st.badge,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {r.statusKey}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-destructive font-mono">
                        {ruptureCost > 0
                          ? `${ruptureCost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`
                          : "0 €"}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-primary">
                        {r.opt.recommendedOrder > 0 ? (
                          `+${r.opt.recommendedOrder} u`
                        ) : r.statusKey === "Rupture" ? (
                          <span className="relative group inline-flex items-center gap-1 text-muted-foreground cursor-help">
                            —
                            <HelpCircle className="h-3.5 w-3.5 text-destructive/70" />
                            <span className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-72 rounded-xl border border-border bg-card p-3 text-[11px] text-foreground shadow-lg z-10 leading-relaxed font-normal">
                              <span className="font-bold text-destructive block mb-1">
                                ⚠ Rupture sans recommande
                              </span>
                              {ruptureNoOrderReason(r)}
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
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
