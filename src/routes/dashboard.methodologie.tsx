import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, FlaskConical, FunctionSquare, Lightbulb, ListChecks } from "lucide-react";

export const Route = createFileRoute("/dashboard/methodologie")({
  head: () => ({ meta: [{ title: "Méthodologie & Formules — FlowStockAI" }] }),
  component: MethodologiePage,
});

const SECTIONS = [
  {
    id: "methodologie",
    icon: BookOpen,
    title: "Méthodologie",
    content: [
      {
        subtitle: "Approche générale",
        body: "FlowStockAI adopte une approche en trois étapes : (1) collecte et nettoyage des données historiques de vente, (2) modélisation statistique et IA de la demande future, et (3) optimisation des niveaux de stock via un solveur multi-objectifs.",
      },
      {
        subtitle: "Prévision de la demande (Forecasting)",
        body: "Les séries temporelles sont analysées avec un modèle de décomposition (tendance + saisonnalité + résidus). FlowStockAI combine la régression exponentielle (Holt-Winters) et, lorsque les données sont suffisantes, un modèle ARIMA automatiquement ajusté. L'horizon de prévision par défaut est de 12 semaines.",
      },
      {
        subtitle: "Optimisation du stock (Solver Engine)",
        body: "Le solveur minimise le coût total (coût de commande + coût de stockage + coût de rupture) sous contraintes de budget, capacité d'entrepôt et délai fournisseur. Il s'appuie sur la programmation linéaire mixte (PLM) via une résolution itérative.",
      },
      {
        subtitle: "Analyse What-If",
        body: "Les scénarios What-If permettent de simuler des variations de paramètres (taux de service cible, délai fournisseur, coût unitaire, etc.) en appliquant les mêmes formules en temps réel, sans modifier les données de production.",
      },
    ],
  },
  {
    id: "formules",
    icon: FunctionSquare,
    title: "Formules",
    content: [
      {
        subtitle: "Point de commande (Reorder Point — ROP)",
        body: "ROP = (Demande journalière moyenne × Délai fournisseur en jours) + Stock de sécurité",
      },
      {
        subtitle: "Quantité économique de commande (EOQ)",
        body: "EOQ = √(2 × Demande annuelle × Coût par commande / Coût de possession unitaire annuel)",
      },
      {
        subtitle: "Stock de sécurité",
        body: "SS = Z × σ_demande × √(Délai fournisseur)  —  où Z est le facteur de service (ex. 1,65 pour 95 %) et σ_demande est l'écart-type de la demande sur la période.",
      },
      {
        subtitle: "Taux de rotation des stocks",
        body: "Rotation = Coût des marchandises vendues (COGS) / Stock moyen",
      },
      {
        subtitle: "Couverture en jours (Days of Supply)",
        body: "Couverture = Stock disponible / Demande journalière moyenne",
      },
      {
        subtitle: "Coût total de possession (Total Cost)",
        body: "Coût total = (Demande annuelle / Q) × Coût par commande + (Q / 2) × Coût de possession unitaire  —  où Q est la quantité commandée.",
      },
    ],
  },
  {
    id: "hypotheses",
    icon: FlaskConical,
    title: "Hypothèses & Variables",
    content: [
      {
        subtitle: "Variables d'entrée",
        body: "Demande historique (hebdomadaire/mensuelle), délai fournisseur (jours), coût unitaire d'achat, coût de commande fixe, taux de possession annuel (% du coût unitaire), taux de service cible (%), stock actuel, stock en commande.",
      },
      {
        subtitle: "Hypothèses du modèle",
        body: "La demande suit une distribution approximativement normale sur la période de prévision. Les délais fournisseurs sont considérés constants sauf configuration explicite de la variabilité. Les coûts sont supposés stables sur l'horizon d'analyse.",
      },
      {
        subtitle: "Limites",
        body: "Le modèle ne prend pas en compte les promotions exceptionnelles ni les événements ponctuels non historisés. Les résultats sont des recommandations — la validation métier reste indispensable avant toute décision d'achat.",
      },
    ],
  },
  {
    id: "exemples",
    icon: ListChecks,
    title: "Exemples de calcul",
    content: [
      {
        subtitle: "Exemple EOQ",
        body: "Demande annuelle = 10 000 unités, Coût par commande = 50 €, Coût de possession = 2 €/unité/an → EOQ = √(2 × 10 000 × 50 / 2) = √500 000 ≈ 707 unités par commande.",
      },
      {
        subtitle: "Exemple Stock de sécurité",
        body: "σ_demande = 20 unités/semaine, Délai = 2 semaines, Z (95 %) = 1,65 → SS = 1,65 × 20 × √2 ≈ 46,7 unités ≈ 47 unités arrondies.",
      },
      {
        subtitle: "Exemple ROP",
        body: "Demande journalière moyenne = 50 unités, Délai = 7 jours, SS = 47 unités → ROP = (50 × 7) + 47 = 397 unités.",
      },
    ],
  },
];

function MethodologiePage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" /> Méthodologie &amp; Formules
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Principes, modèles mathématiques et formules utilisés par le moteur FlowStockAI.
        </p>
      </div>

      {/* Quick-nav pills */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-xs font-medium hover:border-primary/50 hover:text-primary transition-colors"
            >
              <Icon className="h-3.5 w-3.5" />
              {s.title}
            </a>
          );
        })}
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <section key={section.id} id={section.id} className="rounded-2xl border border-border bg-card p-6 scroll-mt-6">
            <h2 className="text-base font-bold flex items-center gap-2 mb-5 pb-3 border-b border-border">
              <Icon className="h-5 w-5 text-primary" />
              {section.title}
            </h2>

            <div className="space-y-5">
              {section.content.map((item, idx) => (
                <div key={idx} className="grid sm:grid-cols-[200px_1fr] gap-2 sm:gap-6">
                  <div className="flex items-start gap-2 pt-0.5">
                    <Lightbulb className="h-3.5 w-3.5 text-primary/70 mt-0.5 flex-shrink-0" />
                    <span className="text-xs font-bold text-foreground leading-tight">{item.subtitle}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed font-mono whitespace-pre-wrap">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Footer note */}
      <div className="text-[10px] text-muted-foreground font-mono text-center pb-4">
        FlowStockAI v1.0.0 — Modèles mis à jour en 2026. Pour toute question méthodologique, contactez votre administrateur.
      </div>
    </div>
  );
}
