import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Brain,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeSOPAdaptive,
  type Lifecycle,
  type SOPAdaptiveResult,
} from "../../sop-engine/services/sopEngineAdaptive";
import { explainDecision, type ExplainResult } from "../../sop-engine/services/explainEngine";

export const Route = createFileRoute("/dashboard/sop-demo")({
  head: () => ({ meta: [{ title: "S&OP Demo — FlowStockAI" }] }),
  component: SOPDemoPage,
});

// ─── Mock SKU parameters (editable) ──────────────────────────────────────────

interface MockSKU {
  id: string;
  skuCode: string;
  name: string;
  category: string;
  consumption3m: number;
  consumption12m: number;
  onHand: number;
  reserved: number;
  onOrder: number;
  inProduction: number;
  leadTime: number;
  reviewPeriod: number;
  orderingCost: number;
  holdingCost: number;
  unitCost: number;
  initialForecast: number;
  min: number;
  max: number;
}

const INITIAL_SKUS: MockSKU[] = [
  {
    id: "A001",
    skuCode: "A001",
    name: "Composant Électronique Principal",
    category: "Électronique",
    consumption3m: 9000,
    consumption12m: 36000,
    onHand: 250,
    reserved: 20,
    onOrder: 100,
    inProduction: 0,
    leadTime: 14,
    reviewPeriod: 7,
    orderingCost: 120,
    holdingCost: 8,
    unitCost: 45,
    initialForecast: 100,
    min: 0,
    max: 0,
  },
  {
    id: "B002",
    skuCode: "B002",
    name: "Nouveau Produit Lancement Q1",
    category: "Innovation",
    consumption3m: 1200,
    consumption12m: 0,
    onHand: 80,
    reserved: 5,
    onOrder: 50,
    inProduction: 0,
    leadTime: 21,
    reviewPeriod: 7,
    orderingCost: 80,
    holdingCost: 6,
    unitCost: 120,
    initialForecast: 15,
    min: 0,
    max: 0,
  },
  {
    id: "C003",
    skuCode: "C003",
    name: "Pièce Standard Mécanique",
    category: "Mécanique",
    consumption3m: 3600,
    consumption12m: 14400,
    onHand: 600,
    reserved: 30,
    onOrder: 0,
    inProduction: 0,
    leadTime: 7,
    reviewPeriod: 7,
    orderingCost: 50,
    holdingCost: 4,
    unitCost: 12,
    initialForecast: 40,
    min: 0,
    max: 0,
  },
  {
    id: "D004",
    skuCode: "D004",
    name: "Produit Fin de Vie (Obsolète)",
    category: "Legacy",
    consumption3m: 150,
    consumption12m: 6000,
    onHand: 420,
    reserved: 0,
    onOrder: 0,
    inProduction: 0,
    leadTime: 30,
    reviewPeriod: 7,
    orderingCost: 60,
    holdingCost: 5,
    unitCost: 80,
    initialForecast: 2,
    min: 0,
    max: 0,
  },
  {
    id: "E005",
    skuCode: "E005",
    name: "Matière Première Volatile",
    category: "Matières",
    consumption3m: 4500,
    consumption12m: 15000,
    onHand: 120,
    reserved: 10,
    onOrder: 80,
    inProduction: 40,
    leadTime: 10,
    reviewPeriod: 7,
    orderingCost: 90,
    holdingCost: 7,
    unitCost: 28,
    initialForecast: 55,
    min: 0,
    max: 0,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

function SOPDemoPage() {
  const [skus, setSkus] = useState<MockSKU[]>(INITIAL_SKUS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const results = useMemo(
    () =>
      skus.map((s) => ({
        sku: s,
        sop: computeSOPAdaptive(s),
      })),
    [skus],
  );

  const enriched = useMemo(
    () =>
      results.map(({ sku, sop }) => ({
        sku,
        sop,
        explain: explainDecision({ ...sop, name: sku.name, skuCode: sku.skuCode }),
      })),
    [results],
  );

  function updateSKU(id: string, field: keyof MockSKU, value: number) {
    setSkus((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  function resetSKUs() {
    setSkus(INITIAL_SKUS);
  }

  const highRisk = enriched.filter((e) => e.explain.risk === "HIGH").length;
  const mediumRisk = enriched.filter((e) => e.explain.risk === "MEDIUM").length;
  const newSkus = enriched.filter((e) => e.sop.lifecycle === "NEW").length;
  const obsoleteSkus = enriched.filter((e) => e.sop.lifecycle === "OBSOLETE").length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* ── Storytelling Header ─────────────────────────────────────────────── */}
      <StorytellingBanner />

      {/* ── Global KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniKpi label="SKUs analysés" value={enriched.length} color="primary" />
        <MiniKpi label="Risque élevé" value={highRisk} color="destructive" />
        <MiniKpi label="Risque moyen" value={mediumRisk} color="warning" />
        <MiniKpi label="Nouveaux SKUs" value={newSkus} color="chart-4" />
      </div>

      {/* ── Reset button ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Modifiez les paramètres pour voir le recalcul en temps réel.{" "}
          <span className="text-primary font-medium">Tous les calculs S&OP sont instantanés.</span>
        </p>
        <button
          onClick={resetSKUs}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
        </button>
      </div>

      {/* ── SKU Cards ───────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {enriched.map(({ sku, sop, explain }) => (
          <SKUCard
            key={sku.id}
            sku={sku}
            sop={sop}
            explain={explain}
            expanded={expandedId === sku.id}
            onToggle={() => setExpandedId(expandedId === sku.id ? null : sku.id)}
            onChange={(field, value) => updateSKU(sku.id, field, value)}
          />
        ))}
      </div>

      {/* ── Legend & System explanation ─────────────────────────────────────── */}
      <SystemLegend obsoleteCount={obsoleteSkus} />
    </div>
  );
}

// ─── Storytelling Banner ──────────────────────────────────────────────────────

function StorytellingBanner() {
  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-chart-4/10 p-6 lg:p-8">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center flex-shrink-0">
          <Brain className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-xl lg:text-2xl font-bold tracking-tight">
              Moteur S&OP Adaptatif — Démonstration Intelligence
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider">
              LIVE
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
            Ce tableau de bord démontre l'intelligence du moteur{" "}
            <strong className="text-foreground">FlowStockAI</strong> : détection automatique du
            cycle de vie (NEW / MATURE / OBSOLETE), calcul S&OP adaptatif (Min/Max, ROP, stock de
            sécurité), priorisation des risques et explications automatiques en langage naturel — en
            temps réel, sans configuration.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <FeatureChip icon={Zap} label="Recalcul instantané sur modification" />
            <FeatureChip icon={Brain} label="Logique adaptative par cycle de vie" />
            <FeatureChip icon={AlertTriangle} label="Indicateurs de risque visuels" />
            <FeatureChip icon={CheckCircle2} label="Explications automatiques par SKU" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureChip({ icon: Icon, label }: { icon: typeof Zap; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-primary/20 bg-primary/5 text-primary font-medium">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ─── Mini KPI card ────────────────────────────────────────────────────────────

function MiniKpi({ label, value, color }: { label: string; value: number; color: string }) {
  const borderColor =
    color === "destructive"
      ? "border-destructive/40"
      : color === "warning"
        ? "border-warning/40"
        : color === "chart-4"
          ? "border-chart-4/40"
          : "border-primary/40";
  const textColor =
    color === "destructive"
      ? "text-destructive"
      : color === "warning"
        ? "text-warning"
        : color === "chart-4"
          ? "text-chart-4"
          : "text-primary";
  return (
    <div className={cn("rounded-2xl border bg-card p-4", borderColor)}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
        {label}
      </div>
      <div className={cn("text-3xl font-bold", textColor)}>{value}</div>
    </div>
  );
}

// ─── SKU Card ─────────────────────────────────────────────────────────────────

interface SKUCardProps {
  sku: MockSKU;
  sop: SOPAdaptiveResult;
  explain: ExplainResult;
  expanded: boolean;
  onToggle: () => void;
  onChange: (field: keyof MockSKU, value: number) => void;
}

function SKUCard({ sku, sop, explain, expanded, onToggle, onChange }: SKUCardProps) {
  const riskBorder =
    explain.risk === "HIGH"
      ? "border-destructive/60"
      : explain.risk === "MEDIUM"
        ? "border-warning/60"
        : "border-border";
  const riskBg =
    explain.risk === "HIGH"
      ? "bg-destructive/5"
      : explain.risk === "MEDIUM"
        ? "bg-warning/5"
        : "bg-card";

  return (
    <div className={cn("rounded-2xl border transition-all", riskBorder, riskBg)}>
      {/* Header row */}
      <div className="flex items-center gap-3 p-4 cursor-pointer select-none" onClick={onToggle}>
        <LifecycleBadge lifecycle={sop.lifecycle} />
        <RiskBadge risk={explain.risk} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{sku.name}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {sku.skuCode} · {sku.category}
          </div>
        </div>

        {/* Key metrics */}
        <div className="hidden sm:flex items-center gap-6 text-xs">
          <Metric label="Stock projeté" value={Math.round(sop.projected)} />
          <Metric label="ROP" value={Math.round(sop.rop)} />
          <Metric label="Min" value={Math.round(sop.min)} />
          <Metric label="Max" value={Math.round(sop.max)} />
          <Metric label="SS" value={Math.round(sop.safetyStock)} />
        </div>

        {/* Action badge */}
        <ActionBadge action={sop.recommendation.action} />

        <button className="text-muted-foreground hover:text-foreground transition-colors ml-1">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Mobile metrics row */}
      <div className="sm:hidden px-4 pb-3 flex gap-4 text-xs overflow-x-auto">
        <Metric label="Projeté" value={Math.round(sop.projected)} />
        <Metric label="ROP" value={Math.round(sop.rop)} />
        <Metric label="Min" value={Math.round(sop.min)} />
        <Metric label="Max" value={Math.round(sop.max)} />
        <Metric label="SS" value={Math.round(sop.safetyStock)} />
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-border grid lg:grid-cols-2 gap-0">
          {/* Left: explanation */}
          <div className="p-5 space-y-4 border-b lg:border-b-0 lg:border-r border-border">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-primary" /> Analyse automatique
            </h3>
            {explain.warning && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs text-warning-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
                <span>{explain.warning}</span>
              </div>
            )}
            <div className="space-y-2">
              {explain.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                  {r}
                </div>
              ))}
            </div>
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs">
              <span className="font-bold text-primary">Conseil : </span>
              <span className="text-foreground">{explain.advice}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Confiance moteur : <strong>{Math.round(explain.confidence * 100)}%</strong>
              {sop.recommendation.action !== "HOLD" && (
                <span className="ml-auto font-mono font-bold">
                  Qté recommandée : {sop.recommendation.quantity} u
                </span>
              )}
            </div>
          </div>

          {/* Right: editable parameters */}
          <div className="p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-primary" /> Paramètres (recalcul live)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <EditableParam
                label="Conso 3 mois"
                value={sku.consumption3m}
                onChange={(v) => onChange("consumption3m", v)}
              />
              <EditableParam
                label="Conso 12 mois"
                value={sku.consumption12m}
                onChange={(v) => onChange("consumption12m", v)}
              />
              <EditableParam
                label="Stock actuel"
                value={sku.onHand}
                onChange={(v) => onChange("onHand", v)}
              />
              <EditableParam
                label="En commande"
                value={sku.onOrder}
                onChange={(v) => onChange("onOrder", v)}
              />
              <EditableParam
                label="En production"
                value={sku.inProduction}
                onChange={(v) => onChange("inProduction", v)}
              />
              <EditableParam
                label="Délai appro (jours)"
                value={sku.leadTime}
                onChange={(v) => onChange("leadTime", v)}
              />
            </div>
            {/* SOP details grid */}
            <div className="mt-2 pt-3 border-t border-border grid grid-cols-3 gap-2 text-[11px]">
              <SOPDetail label="Demande moy/j" value={(sop.avgDemand || 0).toFixed(1)} />
              <SOPDetail label="Sigma (σ)" value={(sop.sigma || 0).toFixed(2)} />
              <SOPDetail label="Z utilisé" value={(sop.z || 0).toFixed(2)} />
              <SOPDetail label="Safety Stock" value={Math.round(sop.safetyStock)} />
              <SOPDetail label="ROP" value={Math.round(sop.rop)} />
              <SOPDetail label="Projeté" value={Math.round(sop.projected)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const styles: Record<Lifecycle, string> = {
    NEW: "bg-chart-4/15 text-chart-4 border-chart-4/40",
    MATURE: "bg-success/10 text-success border-success/30",
    OBSOLETE: "bg-muted text-muted-foreground border-border",
  };
  const icons: Record<Lifecycle, string> = { NEW: "🌱", MATURE: "✅", OBSOLETE: "📦" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border flex-shrink-0",
        styles[lifecycle],
      )}
    >
      {icons[lifecycle]} {lifecycle}
    </span>
  );
}

function RiskBadge({ risk }: { risk: "HIGH" | "MEDIUM" | "LOW" }) {
  const styles = {
    HIGH: "bg-destructive/10 text-destructive border-destructive/30",
    MEDIUM: "bg-warning/10 text-warning-foreground border-warning/30",
    LOW: "bg-success/5 text-success border-success/20",
  };
  const labels = { HIGH: "🔴 Risque élevé", MEDIUM: "🟡 Risque moyen", LOW: "🟢 OK" };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border flex-shrink-0",
        styles[risk],
      )}
    >
      {labels[risk]}
    </span>
  );
}

function ActionBadge({ action }: { action: "ORDER" | "HOLD" | "REVIEW" }) {
  const styles = {
    ORDER: "bg-destructive/10 text-destructive border-destructive/30",
    REVIEW: "bg-warning/10 text-warning-foreground border-warning/30",
    HOLD: "bg-muted text-muted-foreground border-border",
  };
  const labels = { ORDER: "⬆ Commander", REVIEW: "⚠ Réviser", HOLD: "— Attendre" };
  return (
    <span
      className={cn(
        "hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex-shrink-0",
        styles[action],
      )}
    >
      {labels[action]}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono font-bold">{value}</span>
    </div>
  );
}

function SOPDetail({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono font-bold text-xs">{value}</span>
    </div>
  );
}

function EditableParam({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => {
          const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0) onChange(v);
        }}
        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </label>
  );
}

// ─── System Legend ────────────────────────────────────────────────────────────

function SystemLegend({ obsoleteCount }: { obsoleteCount: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <h2 className="text-base font-bold flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" /> Intelligence du système — Comment ça fonctionne
      </h2>
      <div className="grid sm:grid-cols-3 gap-4 text-xs text-muted-foreground">
        <div className="space-y-2">
          <div className="font-bold text-foreground text-sm">🌱 SKU NEW</div>
          <p>
            Moins de 3 mois d'historique. Le moteur applique un z-score conservateur (2.05), booste
            la demande de +20% et augmente le stock de sécurité pour absorber l'incertitude de
            lancement.
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-bold text-foreground text-sm">✅ SKU MATURE</div>
          <p>
            Historique 3 mois + 12 mois disponibles. Demande pondérée (60% récent / 40% annuel),
            variabilité réelle calculée, z-score standard 1.65 à 95% de taux de service.
          </p>
        </div>
        <div className="space-y-2">
          <div className="font-bold text-foreground text-sm">📦 SKU OBSOLETE</div>
          <p>
            Demande 3 mois inférieure à 30% de la tendance annuelle. Le moteur réduit le service
            cible (z=1.28), bloque les recommandations de commande et suggère la liquidation.
          </p>
        </div>
      </div>
      {obsoleteCount > 0 && (
        <div className="pt-4 border-t border-border text-xs text-muted-foreground">
          <strong className="text-warning">Note :</strong> {obsoleteCount} SKU(s) obsolète(s)
          détecté(s) dans ce jeu de données. En production, ces SKUs déclencheraient une alerte de
          révision de portefeuille.
        </div>
      )}
      <div className="pt-4 border-t border-border text-xs text-muted-foreground">
        <strong className="text-foreground">Formules S&OP utilisées :</strong> Demande = 0.6×Conso3M
        + 0.4×Conso12M | Stock Sécurité = Z × σ × √DélaiAppro | ROP = (Demande × Délai) + SS | Min =
        ROP | Max = ROP + Demande × PériodeRévision
      </div>
    </div>
  );
}
