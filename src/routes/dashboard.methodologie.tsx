import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  FlaskConical,
  FunctionSquare,
  Lightbulb,
  ListChecks,
  Database,
} from "lucide-react";

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
    id: "transit",
    icon: Database,
    title: "Origine des données — colonne Transit",
    content: [
      {
        subtitle: "Définition de la colonne Transit",
        body: "La colonne « Transit » dans le Solveur Engine affiche la valeur du champ on_order de chaque SKU. Cette valeur représente les quantités déjà commandées auprès des fournisseurs mais pas encore réceptionnées en stock physique — c'est-à-dire le pipeline d'approvisionnement en cours.",
      },
      {
        subtitle: "Source de la donnée",
        body: "La valeur on_order est lue directement depuis la table `public.skus` (colonne on_order, type numeric). Elle peut être renseignée de trois façons :\n  1. Manuellement lors de la création/modification d'un SKU.\n  2. Automatiquement incrémentée (+quantité) quand un Bon de Commande passe au statut « Envoyée » ou « En transit ».\n  3. Automatiquement décrémentée (−quantité) quand un Bon de Commande passe au statut « Reçue » (et le stock physique est augmenté en conséquence).",
      },
      {
        subtitle: "Utilisation dans le solveur",
        body: "Le solveur intègre on_order dans le calcul de l'inventaire projeté :\n  Inventaire projeté = Stock physique + on_order − (Demande moyenne × Délai fournisseur)\nCela évite de recommander des commandes superflues quand des approvisionnements sont déjà en route.",
      },
      {
        subtitle: "Fréquence de mise à jour",
        body: "La valeur est mise à jour en temps réel à chaque changement de statut d'un Bon de Commande. Elle est également recalculée à chaque lancement du Silvery Engine ou du Solveur Engine (les calculs utilisent toujours la valeur courante de on_order au moment du run).",
      },
      {
        subtitle: "Exemple",
        body: "SKU-001 a un stock physique de 50 unités et 30 unités on_order (en transit). Demande journalière = 5 u, Délai = 7 jours.\n  Inventaire projeté = 50 + 30 − (5 × 7) = 45 unités.\nSans le transit, l'inventaire projeté serait 50 − 35 = 15 u, ce qui déclencherait une recommande. Grâce au transit (on_order = 30), le solveur sait que le stock sera suffisant et affiche « — » dans la colonne Recommandé.",
      },
    ],
  },
  {
    id: "rupture",
    icon: FlaskConical,
    title: "Statut Rupture — Pourquoi sans quantité recommandée ?",
    content: [
      {
        subtitle: "Cas courant : commandes déjà en route (on_order élevé)",
        body: "Un SKU peut être en statut « Rupture » (stock physique ≤ stock de sécurité) tout en affichant « — » pour la quantité recommandée. Cela se produit quand l'inventaire projeté (stock + on_order − demande pendant le délai) est déjà supérieur au point de commande. Des approvisionnements suffisants sont déjà en transit : recommander une commande supplémentaire serait un doublon.",
      },
      {
        subtitle: "Cas : demande historique nulle ou absente",
        body: "Si l'historique de demande (demand_history) est vide ou ne contient que des zéros, le solveur calcule avg_daily_demand = 0. Le stock de sécurité, le ROP et la quantité recommandée sont alors tous nuls. Même un stock physique de 0 vérifie la condition « stock ≤ safetyStock » (0 ≤ 0 = Rupture), mais aucune commande n'est déclenchée car la demande projetée est nulle. Solution : renseigner l'historique de ventes dans la fiche SKU.",
      },
      {
        subtitle: "Cas : SKU bloqué par MOQ ou contrainte de budget",
        body: "Si la MOQ (quantité minimale de commande) est très grande par rapport aux besoins calculés, le solveur arrondit la recommande à 0 plutôt que de suggérer une quantité fractionnaire. Vérifiez la valeur du champ moq dans la fiche SKU.",
      },
      {
        subtitle: "Cas : horizon déjà couvert par l'inventaire projeté",
        body: "Le solveur calcule un objectif de couverture sur 30 jours (targetCover = demande_journalière × 30). Si l'inventaire projeté couvre déjà cet horizon ET est supérieur au ROP, recommendedOrder = 0 — même si le stock physique est bas. Le stock en transit est considéré comme suffisant pour éviter la rupture réelle.",
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
          <section
            key={section.id}
            id={section.id}
            className="rounded-2xl border border-border bg-card p-6 scroll-mt-6"
          >
            <h2 className="text-base font-bold flex items-center gap-2 mb-5 pb-3 border-b border-border">
              <Icon className="h-5 w-5 text-primary" />
              {section.title}
            </h2>

            <div className="space-y-5">
              {section.content.map((item, idx) => (
                <div key={idx} className="grid sm:grid-cols-[200px_1fr] gap-2 sm:gap-6">
                  <div className="flex items-start gap-2 pt-0.5">
                    <Lightbulb className="h-3.5 w-3.5 text-primary/70 mt-0.5 flex-shrink-0" />
                    <span className="text-xs font-bold text-foreground leading-tight">
                      {item.subtitle}
                    </span>
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
        FlowStockAI v1.0.0 — Modèles mis à jour en 2026. Pour toute question méthodologique,
        contactez votre administrateur.
      </div>
    </div>
  );
}
