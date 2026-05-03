import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeNum, safeStr } from "@/lib/sku-helpers";
import type { Database } from "@/integrations/supabase/types";
import { FileText, Package, CheckCircle2, Truck, XCircle, Clock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type PO = Database["public"]["Tables"]["purchase_orders"]["Row"];
type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/pos")({
  head: () => ({ meta: [{ title: "Bons de Commande — FlowStockAI" }] }),
  component: POsPage,
});

const STATUS_META: Record<string, { label: string; icon: typeof Clock; cls: string }> = {
  draft: {
    label: "Brouillon",
    icon: FileText,
    cls: "bg-secondary text-secondary-foreground border-border",
  },
  sent: { label: "Envoyée", icon: Clock, cls: "bg-primary/15 text-primary border-primary/30" },
  in_transit: {
    label: "En transit",
    icon: Truck,
    cls: "bg-warning/15 text-warning border-warning/30",
  },
  received: {
    label: "Reçue",
    icon: CheckCircle2,
    cls: "bg-success/15 text-success border-success/30",
  },
  cancelled: {
    label: "Annulée",
    icon: XCircle,
    cls: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

type CreateForm = {
  sku_id: string;
  quantity: string;
  unit_cost: string;
  expected_at: string;
  notes: string;
};

const EMPTY_FORM: CreateForm = {
  sku_id: "",
  quantity: "",
  unit_cost: "",
  expected_at: "",
  notes: "",
};

function POsPage() {
  const [pos, setPOs] = useState<PO[]>([]);
  const [skuMap, setSkuMap] = useState<Map<string, Sku>>(new Map());
  const [skuList, setSkuList] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [posRes, skusRes] = await Promise.all([
      supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("skus").select("*").order("sku_code"),
    ]);
    setPOs((posRes.data as PO[] | null) ?? []);
    const list = (skusRes.data as Sku[] | null) ?? [];
    setSkuList(list);
    const map = new Map<string, Sku>();
    for (const s of list) map.set(s.id, s);
    setSkuMap(map);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Pre-fill unit cost when SKU is selected
  function handleSkuChange(skuId: string) {
    const sku = skuMap.get(skuId);
    setForm((f) => ({
      ...f,
      sku_id: skuId,
      unit_cost: sku?.unit_cost != null ? String(sku.unit_cost) : f.unit_cost,
    }));
  }

  async function createPO() {
    if (!form.sku_id) return toast.error("Veuillez sélectionner un SKU.");
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) return toast.error("Quantité invalide.");
    const cost = Number(form.unit_cost);
    if (cost < 0) return toast.error("Coût unitaire invalide.");

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return toast.error("Utilisateur non connecté.");

    setSaving(true);
    try {
      const sku = skuMap.get(form.sku_id);
      const insert = {
        user_id: uid,
        sku_id: form.sku_id,
        po_number: `PO-${Date.now()}-${sku?.sku_code ?? ""}`,
        quantity: qty,
        unit_cost: cost,
        status: "draft" as const,
        ordered_at: new Date().toISOString(),
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
        notes: form.notes || null,
      };
      const { error } = await supabase.from("purchase_orders").insert(insert);
      if (error) throw error;
      toast.success("Bon de commande créé en brouillon");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(po: PO, status: string) {
    const updates: Partial<PO> = { status };
    if (status === "received") updates.received_at = new Date().toISOString();
    const { error } = await supabase
      .from("purchase_orders")
      .update(updates as any)
      .eq("id", po.id);
    if (error) return toast.error(error.message);

    if (status === "received" && po.sku_id) {
      const sku = skuMap.get(po.sku_id);
      if (sku) {
        await supabase
          .from("skus")
          .update({
            stock: safeNum(sku.stock) + safeNum(po.quantity),
            on_order: Math.max(0, safeNum(sku.on_order) - safeNum(po.quantity)),
          })
          .eq("id", sku.id);
      }
    } else if ((status === "sent" || status === "in_transit") && po.sku_id) {
      const sku = skuMap.get(po.sku_id);
      if (sku && po.status === "draft") {
        await supabase
          .from("skus")
          .update({ on_order: safeNum(sku.on_order) + safeNum(po.quantity) })
          .eq("id", sku.id);
      }
    }
    toast.success(`Statut mis à jour : ${STATUS_META[status]?.label ?? status}`);
    await load();
  }

  async function remove(po: PO) {
    if (!confirm(`Supprimer le PO ${safeStr(po.po_number, "?")} ?`)) return;
    const { error } = await supabase.from("purchase_orders").delete().eq("id", po.id);
    if (error) return toast.error(error.message);
    toast.success("PO supprimé");
    await load();
  }

  const totalValue = pos.reduce((acc, p) => acc + safeNum(p.quantity) * safeNum(p.unit_cost), 0);
  const active = pos.filter((p) => p.status !== "received" && p.status !== "cancelled").length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Bons de Commande
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Suivi de tes commandes fournisseurs — du brouillon à la réception.
          </p>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM);
            setShowCreate(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold text-sm hover:shadow-[var(--shadow-elegant)] transition-all"
        >
          <Plus className="h-4 w-4" />
          Nouveau bon de commande
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Total POs
          </div>
          <div className="text-2xl font-bold mt-1">{pos.length}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            PO actifs
          </div>
          <div className="text-2xl font-bold mt-1 text-primary">{active}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 col-span-2 lg:col-span-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Valeur engagée
          </div>
          <div className="text-2xl font-bold mt-1">
            {totalValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
          </div>
        </div>
      </div>

      {/* Create PO modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" /> Nouveau bon de commande
              </h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  SKU *
                </label>
                <select
                  value={form.sku_id}
                  onChange={(e) => handleSkuChange(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— Sélectionner un SKU —</option>
                  {skuList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sku_code ?? s.id}
                      {s.name ? ` — ${s.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    Quantité *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    placeholder="ex : 100"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                    Coût unitaire (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unit_cost}
                    onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
                    placeholder="ex : 12.50"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Livraison prévue
                </label>
                <input
                  type="date"
                  value={form.expected_at}
                  onChange={(e) => setForm((f) => ({ ...f, expected_at: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Instructions, référence fournisseur…"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary/60"
              >
                Annuler
              </button>
              <button
                onClick={createPO}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {saving ? "Création…" : "Créer en brouillon"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">Chargement…</div>
        ) : pos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="mb-4">Aucun bon de commande.</p>
            <button
              onClick={() => {
                setForm(EMPTY_FORM);
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Créer un bon de commande
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40">
                <tr className="text-left text-muted-foreground uppercase tracking-wider">
                  <th className="px-3 py-3">PO #</th>
                  <th className="px-3 py-3">SKU</th>
                  <th className="px-3 py-3">Quantité</th>
                  <th className="px-3 py-3">Coût unité</th>
                  <th className="px-3 py-3">Total</th>
                  <th className="px-3 py-3">Livraison prévue</th>
                  <th className="px-3 py-3">Statut</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => {
                  const meta = STATUS_META[safeStr(p.status, "draft")] ?? STATUS_META.draft;
                  const Icon = meta.icon;
                  const sku = p.sku_id ? skuMap.get(p.sku_id) : undefined;
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-3 font-mono">{p.po_number ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="font-mono font-bold">{sku?.sku_code ?? "—"}</div>
                        <div className="text-muted-foreground text-[10px]">{sku?.name}</div>
                      </td>
                      <td className="px-3 py-3 font-bold">{safeNum(p.quantity)} u</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {safeNum(p.unit_cost).toFixed(2)} €
                      </td>
                      <td className="px-3 py-3 font-bold">
                        {(safeNum(p.quantity) * safeNum(p.unit_cost)).toLocaleString("fr-FR", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        €
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {p.expected_at ? new Date(p.expected_at).toLocaleDateString("fr-FR") : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold",
                            meta.cls,
                          )}
                        >
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <select
                            value={safeStr(p.status, "draft")}
                            onChange={(e) => setStatus(p, e.target.value)}
                            className="bg-background border border-border rounded-md px-1.5 py-1 text-[10px]"
                          >
                            {Object.entries(STATUS_META).map(([k, m]) => (
                              <option key={k} value={k}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => remove(p)}
                            className="px-2 py-1 rounded-md border border-border text-destructive hover:bg-destructive/10 text-[10px]"
                          >
                            Suppr.
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
