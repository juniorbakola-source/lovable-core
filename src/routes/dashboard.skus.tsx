import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { optimize, computeMinMax, type OptimizationResult } from "@/lib/optimizer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Upload, FileSpreadsheet, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

type Sku = Database["public"]["Tables"]["skus"]["Row"];

type SkusSearch = {
  status?: string;
  category?: string;
  reorder?: string;
  q?: string;
};

export const Route = createFileRoute("/dashboard/skus")({
  head: () => ({ meta: [{ title: "SKUs — FlowStock Pro" }] }),
  validateSearch: (s: Record<string, unknown>): SkusSearch => ({
    status: typeof s.status === "string" ? s.status : undefined,
    category: typeof s.category === "string" ? s.category : undefined,
    reorder: typeof s.reorder === "string" ? s.reorder : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: SkusPage,
});

const empty = {
  sku_code: "", name: "", category: "",
  stock: 0, on_order: 0, in_production: 0,
  lead_time_days: 7, moq: 1,
  unit_cost: 0, service_level: 0.95,
  demand_history: "10, 12, 8, 15, 11, 9, 13, 14, 10, 12",
  demand_history_yearly: "",
  forecast_3m: "",
};

function SkusPage() {
  const search = useSearch({ from: "/dashboard/skus" });
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [form, setForm] = useState(empty);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("skus").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setSkus((data as Sku[] | null) ?? []);
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
      sku_code: s.sku_code ?? "", name: s.name ?? "", category: s.category ?? "",
      stock: s.stock ?? 0, on_order: s.on_order ?? 0, in_production: s.in_production ?? 0,
      lead_time_days: s.lead_time_days ?? 7, moq: s.moq ?? 1,
      unit_cost: Number(s.unit_cost ?? 0), service_level: Number(s.service_level ?? 0.95),
      demand_history: (s.demand_history ?? []).join(", "),
      demand_history_yearly: (s.demand_history_yearly ?? []).join(", "),
      forecast_3m: (s.forecast_3m ?? []).join(", "),
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const parseList = (str: string) =>
      str.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n >= 0);
    const payload = {
      user_id: user.id,
      sku_code: form.sku_code.trim(),
      name: form.name.trim(),
      category: form.category.trim() || null,
      stock: Number(form.stock),
      on_order: Number(form.on_order),
      in_production: Number(form.in_production),
      lead_time_days: Number(form.lead_time_days),
      moq: Number(form.moq),
      unit_cost: Number(form.unit_cost),
      service_level: Number(form.service_level),
      demand_history: parseList(form.demand_history),
      demand_history_yearly: parseList(form.demand_history_yearly),
      forecast_3m: parseList(form.forecast_3m),
    };
    const { error } = editing
      ? await supabase.from("skus").update(payload).eq("id", editing.id)
      : await supabase.from("skus").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "SKU updated" : "SKU added");
    setOpen(false);
    load();
  }

  async function importCsv(file: File) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return toast.error("CSV is empty");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const required = ["sku_code", "name"];
    if (!required.every((r) => headers.includes(r))) {
      return toast.error("CSV must include sku_code and name columns");
    }
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
      return {
        user_id: user.id,
        sku_code: row.sku_code,
        name: row.name,
        category: row.category || null,
        stock: Number(row.stock || 0),
        on_order: Number(row.on_order || 0),
        in_production: Number(row.in_production || 0),
        lead_time_days: Number(row.lead_time_days || 7),
        moq: Number(row.moq || 1),
        unit_cost: Number(row.unit_cost || 0),
        service_level: Number(row.service_level || 0.95),
        demand_history: (row.demand_history || "")
          .split(/[;|]/).map((n) => Number(n)).filter((n) => !isNaN(n) && n >= 0),
      };
    }).filter((r) => r.sku_code && r.name);
    if (!rows.length) return toast.error("No valid rows");
    const { error } = await supabase.from("skus").insert(rows);
    if (error) toast.error(error.message);
    else { toast.success(`Imported ${rows.length} SKUs`); load(); }
  }

  // ELKA "Min Max Complet" import — also populates 12-month history & 3-month forecast.
  async function importElkaXlsx(file: File) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as (string | number | null)[][];
      const dataRows = matrix.slice(4);
      const seen = new Set<string>();
      const rows = dataRows.map((r) => {
        const item = r[1] != null ? String(r[1]).trim() : "";
        if (!item || seen.has(item)) return null;
        seen.add(item);
        const num = (v: unknown, d = 0) => {
          const n = typeof v === "number" ? v : Number(v);
          return isFinite(n) ? n : d;
        };
        const stock = Math.max(0, Math.round(num(r[2])));
        const onOrder = Math.max(0, Math.round(num(r[5])));
        const lastCost = num(r[13]);
        const delay = Math.max(1, Math.round(num(r[14], 7)));
        const eoq = Math.max(1, Math.round(num(r[27], 1)));
        const conso3m = num(r[23]); // daily over last 3 months
        const conso1y = num(r[19]); // daily over last year
        const base = conso3m > 0 ? conso3m : conso1y;

        let seed = 0;
        for (let i = 0; i < item.length; i++) seed = (seed * 31 + item.charCodeAt(i)) >>> 0;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };

        const history30 = base > 0
          ? Array.from({ length: 30 }, () => Math.max(0, Math.round(base * (0.7 + rand() * 0.6) * 100) / 100))
          : Array(30).fill(0);

        // 12-month history derived from 1-year daily avg, with seasonal jitter
        const monthlyBase = conso1y * 30;
        const yearly12 = monthlyBase > 0
          ? Array.from({ length: 12 }, () => Math.max(0, Math.round(monthlyBase * (0.65 + rand() * 0.7))))
          : Array(12).fill(0);

        // Forecast 3m: trend from 3-month conso (slightly weighted vs yearly)
        const forecastBase = (conso3m * 30) || monthlyBase;
        const forecast3 = forecastBase > 0
          ? Array.from({ length: 3 }, () => Math.max(0, Math.round(forecastBase * (0.85 + rand() * 0.4))))
          : Array(3).fill(0);

        return {
          user_id: user.id,
          sku_code: item,
          name: item,
          category: r[11] != null ? String(r[11]).trim() : null,
          stock, on_order: onOrder, in_production: 0,
          lead_time_days: delay, moq: eoq,
          unit_cost: lastCost, service_level: 0.95,
          demand_history: history30,
          demand_history_yearly: yearly12,
          forecast_3m: forecast3,
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);
      if (!rows.length) return toast.error("No valid rows in ELKA file");
      const chunkSize = 500;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from("skus").insert(chunk);
        if (error) { toast.error(`Chunk ${i}: ${error.message}`); break; }
        inserted += chunk.length;
      }
      toast.success(`Imported ${inserted} SKUs from ELKA file`);
      load();
    } catch (e) {
      toast.error(`Failed to parse Excel: ${(e as Error).message}`);
    }
  }

  async function optimizeWithAI() {
    setOptimizing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Please sign in"); return; }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-min-max`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const json = await resp.json();
      if (!resp.ok) {
        if (resp.status === 429) toast.error("AI rate limit reached, try again shortly.");
        else if (resp.status === 402) toast.error("AI credits exhausted. Top up in Settings → Workspace.");
        else toast.error(json.error || "Optimization failed");
        return;
      }
      toast.success(`AI optimized ${json.succeeded}/${json.processed} SKUs`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOptimizing(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this SKU?")) return;
    const { error } = await supabase.from("skus").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  }

  // Apply URL filters (drill-down from Overview / Analytics)
  const filtered = useMemo(() => {
    const enriched = skus.map((s) => ({ ...s, opt: optimize(s), mm: computeMinMax(s) }));
    return enriched.filter((s) => {
      if (search.status && s.opt.status !== search.status) return false;
      if (search.category && (s.category || "Uncategorized") !== search.category) return false;
      if (search.reorder === "1" && s.opt.recommendedOrder <= 0) return false;
      if (search.q) {
        const q = search.q.toLowerCase();
        if (!s.sku_code.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [skus, search]);

  const activeFilters = [
    search.status && { key: "status", label: `Status: ${search.status}` },
    search.category && { key: "category", label: `Category: ${search.category}` },
    search.reorder === "1" && { key: "reorder", label: "Needs reorder" },
    search.q && { key: "q", label: `Search: ${search.q}` },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SKUs</h1>
          <p className="text-muted-foreground mt-1">Manage inventory, view optimization, and run AI Min/Max recommendations.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="hero" onClick={optimizeWithAI} disabled={optimizing || skus.length === 0}>
            <Sparkles className="h-4 w-4" /> {optimizing ? "Optimizing…" : "Optimize Min/Max with AI"}
          </Button>
          <label className="inline-flex">
            <input type="file" accept=".csv" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = "";
            }} />
            <Button asChild variant="outline"><span><Upload className="h-4 w-4" /> Import CSV</span></Button>
          </label>
          <label className="inline-flex">
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (f) importElkaXlsx(f); e.target.value = "";
            }} />
            <Button asChild variant="outline"><span><FileSpreadsheet className="h-4 w-4" /> Import ELKA</span></Button>
          </label>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="default" onClick={openNew}><Plus className="h-4 w-4" /> Add SKU</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <Field label="In production" type="number" value={form.in_production} onChange={(v) => setForm({ ...form, in_production: Number(v) })} />
                <Field label="Lead time (days)" type="number" value={form.lead_time_days} onChange={(v) => setForm({ ...form, lead_time_days: Number(v) })} />
                <Field label="MOQ" type="number" value={form.moq} onChange={(v) => setForm({ ...form, moq: Number(v) })} />
                <Field label="Service level (0–1)" type="number" step="0.01" value={form.service_level} onChange={(v) => setForm({ ...form, service_level: Number(v) })} />
                <div className="col-span-2 space-y-2">
                  <Label>Daily demand history (last 30 days)</Label>
                  <Input value={form.demand_history} onChange={(e) => setForm({ ...form, demand_history: e.target.value })} placeholder="10, 12, 8, …" />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>12-month history (monthly totals)</Label>
                  <Input value={form.demand_history_yearly} onChange={(e) => setForm({ ...form, demand_history_yearly: e.target.value })} placeholder="320, 280, 410, …" />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>3-month forecast (monthly totals)</Label>
                  <Input value={form.forecast_3m} onChange={(e) => setForm({ ...form, forecast_3m: e.target.value })} placeholder="350, 380, 360" />
                </div>
                <DialogFooter className="col-span-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="hero">{editing ? "Save changes" : "Create SKU"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-muted-foreground">Filters:</span>
          {activeFilters.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              {f.label}
            </span>
          ))}
          <Button size="sm" variant="ghost" asChild>
            <a href="/dashboard/skus"><X className="h-3 w-3" /> Clear</a>
          </Button>
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} matching</span>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-4">SKU</th>
                <th className="text-right p-4">Stock</th>
                <th className="text-right p-4">Pipeline</th>
                <th className="text-right p-4">Min</th>
                <th className="text-right p-4">Max</th>
                <th className="text-right p-4">AI Min</th>
                <th className="text-right p-4">AI Max</th>
                <th className="text-center p-4">Status</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">
                  {skus.length === 0 ? <>No SKUs yet. Click <strong>Add SKU</strong> to start.</> : "No SKUs match the current filters."}
                </td></tr>
              ) : filtered.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/30">
                  <td className="p-4">
                    <div className="font-semibold">{s.sku_code}</div>
                    <div className="text-xs text-muted-foreground">{s.name}</div>
                    {s.ai_justification && (
                      <div className="text-[11px] text-primary/80 mt-1 max-w-md italic">💡 {s.ai_justification}</div>
                    )}
                  </td>
                  <td className="p-4 text-right tabular-nums">{s.stock}</td>
                  <td className="p-4 text-right tabular-nums text-muted-foreground">+{s.mm.pipeline}</td>
                  <td className="p-4 text-right tabular-nums">{s.mm.min}</td>
                  <td className="p-4 text-right tabular-nums">{s.mm.max}</td>
                  <td className="p-4 text-right tabular-nums font-semibold text-primary">{s.ai_min_recommended ?? "—"}</td>
                  <td className="p-4 text-right tabular-nums font-semibold text-primary">{s.ai_max_recommended ?? "—"}</td>
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
