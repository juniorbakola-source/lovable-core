import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize, type OptimizationResult } from "@/lib/optimizer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

export const Route = createFileRoute("/dashboard/skus")({
  head: () => ({ meta: [{ title: "SKUs — FlowStock Pro" }] }),
  component: SkusPage,
});

const empty = {
  sku_code: "", name: "", category: "",
  stock: 0, on_order: 0, lead_time_days: 7, moq: 1,
  unit_cost: 0, service_level: 0.95,
  demand_history: "10, 12, 8, 15, 11, 9, 13, 14, 10, 12",
};

function SkusPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [form, setForm] = useState(empty);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("skus").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setSkus(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(s: Sku) {
    setEditing(s);
    setForm({
      sku_code: s.sku_code, name: s.name, category: s.category ?? "",
      stock: s.stock, on_order: s.on_order, lead_time_days: s.lead_time_days,
      moq: s.moq, unit_cost: Number(s.unit_cost), service_level: Number(s.service_level),
      demand_history: s.demand_history.join(", "),
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const demand_history = form.demand_history
      .split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n >= 0);
    const payload = {
      user_id: user.id,
      sku_code: form.sku_code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      stock: Number(form.stock),
      on_order: Number(form.on_order),
      lead_time_days: Number(form.lead_time_days),
      moq: Number(form.moq),
      unit_cost: Number(form.unit_cost),
      service_level: Number(form.service_level),
      demand_history,
    };
    const { error } = editing
      ? await supabase.from("skus").update(payload).eq("id", editing.id)
      : await supabase.from("skus").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "SKU updated" : "SKU added");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this SKU?")) return;
    const { error } = await supabase.from("skus").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  }

  const enriched = skus.map((s) => ({ ...s, opt: optimize(s) }));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SKUs</h1>
          <p className="text-muted-foreground mt-1">Manage your inventory and view optimization recommendations.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Add SKU</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit SKU" : "New SKU"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="grid grid-cols-2 gap-4">
              <Field label="SKU code" required value={form.sku_code} onChange={(v) => setForm({ ...form, sku_code: v })} />
              <Field label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <Field label="Unit cost ($)" type="number" step="0.01" value={form.unit_cost} onChange={(v) => setForm({ ...form, unit_cost: Number(v) })} />
              <Field label="Current stock" type="number" value={form.stock} onChange={(v) => setForm({ ...form, stock: Number(v) })} />
              <Field label="On order" type="number" value={form.on_order} onChange={(v) => setForm({ ...form, on_order: Number(v) })} />
              <Field label="Lead time (days)" type="number" value={form.lead_time_days} onChange={(v) => setForm({ ...form, lead_time_days: Number(v) })} />
              <Field label="MOQ" type="number" value={form.moq} onChange={(v) => setForm({ ...form, moq: Number(v) })} />
              <Field label="Service level (0–1)" type="number" step="0.01" value={form.service_level} onChange={(v) => setForm({ ...form, service_level: Number(v) })} />
              <div className="col-span-2 space-y-2">
                <Label>Demand history (comma-separated daily values)</Label>
                <Input value={form.demand_history} onChange={(e) => setForm({ ...form, demand_history: e.target.value })} placeholder="10, 12, 8, 15, …" />
              </div>
              <DialogFooter className="col-span-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" variant="hero">{editing ? "Save changes" : "Create SKU"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-4">SKU</th>
                <th className="text-right p-4">Stock</th>
                <th className="text-right p-4">Forecast/d</th>
                <th className="text-right p-4">Reorder pt</th>
                <th className="text-right p-4">Days cover</th>
                <th className="text-right p-4">To order</th>
                <th className="text-center p-4">Status</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : enriched.length === 0 ? (
                <tr><td colSpan={8} className="p-12 text-center text-muted-foreground">
                  No SKUs yet. Click <strong>Add SKU</strong> to start.
                </td></tr>
              ) : enriched.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-4">
                    <div className="font-semibold">{s.sku_code}</div>
                    <div className="text-xs text-muted-foreground">{s.name}</div>
                  </td>
                  <td className="p-4 text-right tabular-nums">{s.stock}</td>
                  <td className="p-4 text-right tabular-nums">{s.opt.avgDailyDemand.toFixed(1)}</td>
                  <td className="p-4 text-right tabular-nums">{s.opt.reorderPoint}</td>
                  <td className="p-4 text-right tabular-nums">{s.opt.daysOfCover === 999 ? "∞" : s.opt.daysOfCover}</td>
                  <td className="p-4 text-right tabular-nums font-semibold">{s.opt.recommendedOrder > 0 ? s.opt.recommendedOrder : "—"}</td>
                  <td className="p-4 text-center"><StatusBadge status={s.opt.status} /></td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, step }: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; required?: boolean; step?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      <Input type={type} step={step} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function StatusBadge({ status }: { status: OptimizationResult["status"] }) {
  const styles: Record<OptimizationResult["status"], string> = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    low: "bg-warning/10 text-warning-foreground border-warning/30",
    ok: "bg-success/10 text-success border-success/20",
    overstock: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<OptimizationResult["status"], string> = {
    critical: "Critical", low: "Reorder", ok: "Healthy", overstock: "Overstock",
  };
  return (
    <span className={cn("inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border", styles[status])}>
      {labels[status]}
    </span>
  );
}
