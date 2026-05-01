import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Settings as SettingsIcon, Building, KeyRound, Sparkles, Copy } from "lucide-react";

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({ meta: [{ title: "Paramètres — FlowStockAI" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const orgName = (user?.user_metadata?.company as string | undefined) ?? "Mon Organisation";
  const fakeApiKey = `sk_live_flowstock_${(user?.id ?? "demo").slice(0, 12)}`;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Mot de passe : 6 caractères minimum");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Mot de passe mis à jour"); setPassword(""); }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" /> Paramètres Compte & Organisation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gérez les configurations multi-tenant, abonnements et intégrations ERP.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-bold flex items-center gap-2 mb-4">
          <Building className="h-4 w-4 text-primary" /> Profil Organisation
        </h2>
        <dl className="grid sm:grid-cols-2 gap-4 text-sm">
          <Row label="Nom de l'Organisation" value={orgName} />
          <Row label="Company ID" value={`comp-${(user?.id ?? "").slice(0, 8)}`} mono />
          <Row label="Utilisateur Courant" value={user?.email ?? "—"} />
          <Row label="Rôle Permission" value="ADMIN_ROOT" badge />
        </dl>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-bold flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-primary" /> Licence & Abonnement
        </h2>
        <div className="flex items-center gap-4 p-4 rounded-xl border border-primary/30 bg-primary/5">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center text-primary-foreground font-bold">
            PRO
          </div>
          <div className="flex-1">
            <div className="font-bold">FlowStockAI Professional</div>
            <div className="text-xs text-muted-foreground">Période d'essai PRO active</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">199,00 €</div>
            <div className="text-xs text-muted-foreground">/ mois</div>
          </div>
        </div>
        <div className="mt-4 space-y-2 text-sm font-mono">
          <div className="flex justify-between"><span className="text-muted-foreground">Quota Utilisateurs :</span><span className="font-bold">1 / 5</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Quota SKUs :</span><span className="font-bold">Actif (limite 1 000)</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Calculateur What-If :</span><span className="text-primary font-bold">Débloqué ✓</span></div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-bold flex items-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-primary" /> Clé API Intégration ERP
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Connectez vos ERPs (Odoo, SAP, NetSuite) via REST API. Authentifiez-vous avec : <code className="text-primary">Authorization: Bearer [CLE_API]</code>
        </p>
        <div className="flex gap-2">
          <code className="flex-1 px-3 py-2 rounded-xl bg-background border border-border text-xs font-mono text-primary truncate">{fakeApiKey}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(fakeApiKey); toast.success("Clé copiée"); }}
            className="px-3 py-2 rounded-xl border border-border hover:border-primary/40 text-xs font-bold inline-flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Copier
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-base font-bold mb-4">Sécurité</h2>
        <form onSubmit={changePassword} className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50">
            {busy ? "…" : "Mettre à jour"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Row({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>
        {badge ? (
          <span className="inline-block px-2 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/30 text-xs font-bold font-mono">{value}</span>
        ) : value}
      </dd>
    </div>
  );
}
