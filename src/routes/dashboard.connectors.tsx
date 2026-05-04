import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { upsertSkus } from "@/lib/sku-ssot";
import { httpConnector } from "@/lib/connectors/http";
import type { HttpConnectorConfig } from "@/lib/connectors/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Play, Plug } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Connector = {
  id: string;
  name: string;
  connector_type: string;
  config: Record<string, unknown>;
  field_mappings: Record<string, string>;
  active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_rows: number | null;
};

const emptyForm = {
  name: "",
  url: "",
  method: "GET" as "GET" | "POST",
  headers_raw: "",
  body: "",
  response_root_key: "",
  // field mappings: comma-separated "external:internal" pairs
  mappings_raw: "item_code:sku_code, description:name, qty_on_hand:stock",
};

export const Route = createFileRoute("/dashboard/connectors")({
  head: () => ({ meta: [{ title: "Connecteurs — FlowStockAI" }] }),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const { user } = useAuth();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [syncing, setSyncing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("connectors")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setConnectors((data as Connector[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(c: Connector) {
    setEditing(c);
    const cfg = c.config as HttpConnectorConfig;
    setForm({
      name: c.name,
      url: (cfg.url as string) ?? "",
      method: (cfg.method as "GET" | "POST") ?? "GET",
      headers_raw: cfg.headers
        ? Object.entries(cfg.headers as Record<string, string>)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "",
      body: (cfg.body as string) ?? "",
      response_root_key: (cfg.responseRootKey as string) ?? "",
      mappings_raw: Object.entries(c.field_mappings)
        .map(([k, v]) => `${k}:${v}`)
        .join(", "),
    });
    setOpen(true);
  }

  function parseMappings(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of raw.split(",")) {
      const [k, v] = pair.trim().split(":");
      if (k && v) result[k.trim()] = v.trim();
    }
    return result;
  }

  function parseHeaders(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return result;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    const config: HttpConnectorConfig = {
      url: form.url.trim(),
      method: form.method,
      headers: form.headers_raw.trim() ? parseHeaders(form.headers_raw) : undefined,
      body: form.body.trim() || undefined,
      responseRootKey: form.response_root_key.trim() || undefined,
    };
    const field_mappings = parseMappings(form.mappings_raw);

    const payload = {
      user_id: user.id,
      name: form.name.trim(),
      connector_type: "http_api",
      config,
      field_mappings,
      active: true,
    };

    const { error } = editing
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("connectors").update(payload).eq("id", editing.id)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("connectors").insert(payload);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? "Connecteur mis à jour" : "Connecteur créé");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Supprimer ce connecteur ?")) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("connectors").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Connecteur supprimé");
      load();
    }
  }

  async function runSync(connector: Connector) {
    if (!user) return;
    setSyncing(connector.id);
    try {
      const { rawRows, error: fetchErr } = await httpConnector.fetch(
        connector.config as HttpConnectorConfig,
      );
      if (fetchErr) throw new Error(fetchErr);

      const { skus, warnings } = httpConnector.map(rawRows, connector.field_mappings);
      if (warnings.length > 0) {
        toast.warning(`${warnings.length} avertissement(s) lors du mapping`);
      }

      if (skus.length === 0) throw new Error("Aucun SKU mappé depuis la source externe");

      const result = await upsertSkus(user.id, skus, "connector", {
        connectorId: connector.id,
      });

      toast.success(
        `Sync terminée — ${result.inserted} insérés, ${result.updated} mis à jour, ${result.failed} erreurs`,
      );

      // Update last_sync_at / status / rows on the connector
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("connectors")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status:
            result.failed === skus.length ? "failed" : result.failed > 0 ? "partial" : "success",
          last_sync_rows: result.inserted + result.updated,
        })
        .eq("id", connector.id);

      load();
    } catch (e) {
      toast.error((e as Error).message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("connectors")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "failed",
          last_sync_rows: 0,
        })
        .eq("id", connector.id);
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Plug className="h-6 w-6 text-primary" /> Connecteurs Externes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Importez automatiquement vos SKUs depuis des APIs, ERPs ou CRMs.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="default" onClick={openNew}>
              <Plus className="h-4 w-4" /> Nouveau connecteur
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Modifier le connecteur" : "Nouveau connecteur HTTP"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div>
                <Label>Nom du connecteur *</Label>
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Mon ERP / Mon API stock"
                />
              </div>

              <div>
                <Label>URL de l&apos;endpoint *</Label>
                <Input
                  required
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://api.exemple.com/skus"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Méthode HTTP</Label>
                  <select
                    className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background"
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value as "GET" | "POST" })}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
                <div>
                  <Label>Clé racine de la réponse</Label>
                  <Input
                    value={form.response_root_key}
                    onChange={(e) => setForm({ ...form, response_root_key: e.target.value })}
                    placeholder="data.items"
                  />
                </div>
              </div>

              <div>
                <Label>Headers (une ligne par header: clé: valeur)</Label>
                <textarea
                  className="w-full border border-input rounded-lg px-3 py-2 text-sm bg-background font-mono min-h-[80px]"
                  value={form.headers_raw}
                  onChange={(e) => setForm({ ...form, headers_raw: e.target.value })}
                  placeholder={"Authorization: Bearer <token>\nX-Api-Version: 2"}
                />
              </div>

              <div>
                <Label>Mapping de champs (externe:interne, séparés par des virgules)</Label>
                <Input
                  value={form.mappings_raw}
                  onChange={(e) => setForm({ ...form, mappings_raw: e.target.value })}
                  placeholder="item_code:sku_code, description:name, qty:stock"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Champs internes disponibles: sku_code, name, category, stock, on_order,
                  in_production, lead_time_days, moq, unit_cost, service_level
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" variant="hero">
                  {editing ? "Sauvegarder" : "Créer"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Chargement…</div>
      ) : connectors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Plug className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aucun connecteur configuré.</p>
          <p className="text-xs mt-1">
            Créez un connecteur HTTP pour importer des SKUs depuis votre ERP ou API.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Plug className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">{c.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {c.connector_type}
                  </span>
                  {!c.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      inactif
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {(c.config as HttpConnectorConfig).url ?? "(no url)"}
                </div>
                {c.last_sync_at && (
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                    Dernière sync: {new Date(c.last_sync_at).toLocaleString()}
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded-full text-[10px] font-bold border",
                        c.last_sync_status === "success"
                          ? "bg-success/15 text-success border-success/30"
                          : c.last_sync_status === "partial"
                            ? "bg-warning/15 text-warning border-warning/30"
                            : "bg-destructive/15 text-destructive border-destructive/30",
                      )}
                    >
                      {c.last_sync_status}
                    </span>
                    {c.last_sync_rows != null && (
                      <span className="text-muted-foreground">{c.last_sync_rows} SKUs</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runSync(c)}
                  disabled={syncing === c.id}
                >
                  <Play className="h-3.5 w-3.5" />
                  {syncing === c.id ? "Sync…" : "Sync"}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
