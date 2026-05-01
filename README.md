# FlowStockAI — lovable-core

> Moteur S&OP adaptatif avec intelligence lifecycle, recalcul live et explications automatiques.

---

## 🚀 Description

**FlowStockAI** est une plateforme de gestion des stocks S&OP (Sales & Operations Planning) de niveau industriel. Elle combine :

- Un **moteur S&OP adaptatif** qui ajuste automatiquement ses paramètres selon le cycle de vie de chaque SKU (NEW / MATURE / OBSOLETE)
- Un **moteur d'explication automatique** produisant des analyses en langage naturel par SKU
- Une **interface web React** avec recalcul live, indicateurs de risque visuels et storytelling démo pour client
- Une **architecture AI-ready** avec placeholder pour intégration LLM (GPT-4, Claude, etc.)

---

## 📦 Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 19, TanStack Router, Tailwind CSS v4 |
| Moteur S&OP | TypeScript pur (`sop-engine/`) |
| Backend | Supabase (auth + base de données) |
| Build | Vite 7 + Cloudflare Workers |

---

## 🏃 Démarrage rapide

```bash
# Installer les dépendances
npm install

# Lancer en développement
npm run dev

# Build de production
npm run build
```

L'application est accessible sur `http://localhost:3000`.

---

## 🧠 Moteur S&OP — `sop-engine/`

### `computeSOPAdaptive(data)` — `sop-engine/services/sopEngineAdaptive.ts`

Cœur du système. Calcule toutes les métriques S&OP pour un SKU en s'adaptant automatiquement à son historique :

```ts
const result = computeSOPAdaptive({
  consumption3m: 9000,   // consommation sur 3 mois
  consumption12m: 36000, // consommation sur 12 mois
  onHand: 250,           // stock disponible
  reserved: 20,          // stock réservé
  onOrder: 100,          // en commande fournisseur
  inProduction: 0,       // en cours de fabrication
  leadTime: 14,          // délai d'approvisionnement (jours)
  reviewPeriod: 7,       // période de révision (jours)
  orderingCost: 120,     // coût de passation de commande
  holdingCost: 8,        // coût de possession (%)
});

// result: {
//   lifecycle: "MATURE",      // NEW | MATURE | OBSOLETE
//   avgDemand: 10.2,          // demande moyenne journalière
//   sigma: 3.1,               // variabilité
//   z: 1.65,                  // z-score service level
//   safetyStock: 19,          // stock de sécurité
//   rop: 162,                 // Reorder Point
//   min: 162,                 // niveau Min
//   max: 233,                 // niveau Max
//   projected: 330,           // stock projeté
//   recommendation: {
//     action: "HOLD",         // ORDER | HOLD | REVIEW
//     quantity: 0,
//     reason: "Stock level is within acceptable range."
//   }
// }
```

#### Logique lifecycle automatique

| Lifecycle | Condition | Comportement |
|---|---|---|
| **MATURE** | Historique 3M + 12M disponibles | Pondération 60/40, z=1.65 |
| **NEW** | Uniquement 3M ou sans historique | Demande +20%, sigma×2, z=2.05 |
| **OBSOLETE** | Demande 3M < 30% de la tendance 12M | z=1.28, commande bloquée, alerte liquidation |

### `explainDecision(sku)` — `sop-engine/services/explainEngine.ts`

Génère une analyse textuelle structurée pour chaque SKU :

```ts
const explanation = explainDecision({
  lifecycle: "NEW",
  projected: 80,
  rop: 120,
  min: 120,
  max: 200,
  avgDemand: 5.5,
  sigma: 2.8,
  recommendation: { action: "ORDER", quantity: 50, reason: "..." }
});

// explanation: {
//   summary: "Nouveau Produit [NEW] 🔴 HIGH RISK — ...",
//   reasons: ["New SKU with limited demand history...", ...],
//   advice: "Order now and monitor demand weekly...",
//   risk: "HIGH",          // HIGH | MEDIUM | LOW
//   confidence: 0.6,
//   warning: "⚠️ NEW SKU: Demand patterns are uncertain..."
// }
```

### `explainSKUWithAI(input)` — `sop-engine/services/aiAssistant.ts`

Placeholder AI pour explications enrichies. Utilise l'explication locale par défaut :

```ts
const aiExplain = await explainSKUWithAI({
  skuCode: "A001",
  name: "Composant Principal",
  sopResult: result,
});

// aiExplain: {
//   narrative: "**Composant Principal (A001)** — Lifecycle: MATURE | Risk: LOW\n...",
//   structuredAnalysis: { ... },
//   source: "local"   // "ai" si un LLM est configuré
// }
```

**Pour intégrer un LLM**, modifier la fonction `callAIExplain` dans `aiAssistant.ts` :

```ts
async function callAIExplain(input: AIExplainInput): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert supply chain planner..." },
        { role: "user", content: JSON.stringify(input) }
      ]
    })
  });
  return (await response.json()).choices[0].message.content;
}
```

---

## 🖥️ Interface — Démo S&OP IA

### Accès

```
/dashboard/sop-demo
```

### Fonctionnalités

| Feature | Description |
|---|---|
| 🌱 Badge Lifecycle | NEW / MATURE / OBSOLETE par SKU avec couleur distinctive |
| 🔴 Indicateur de risque | Risque HIGH / MEDIUM / LOW avec bordure et badge coloré |
| ⚡ Recalcul live | Modification des paramètres → recalcul instantané sans rechargement |
| 🧠 Analyse automatique | Explication naturelle : raisons, conseils, avertissements |
| 📊 Métriques S&OP | Demande moy, σ, z, SS, ROP, Min, Max, Projeté affichés |
| ⬆ Recommandation | Action ORDER / HOLD / REVIEW avec quantité et motif |
| 🏛️ Storytelling | Zone démo avec argumentaire produit et légende système |

### Données mock incluses

5 SKUs représentatifs couvrant tous les cas :

| SKU | Lifecycle | Scénario |
|---|---|---|
| A001 | MATURE | Composant standard avec historique complet |
| B002 | NEW | Nouveau produit lancement Q1 (uniquement 3M) |
| C003 | MATURE | Pièce mécanique — surstock potentiel |
| D004 | OBSOLETE | Produit fin de vie (demande ×20 plus faible) |
| E005 | MATURE | Matière première volatile — risque rupture |

---

## 📊 Formules S&OP utilisées

```
Demande (MATURE)  = (0.6 × Conso3M + 0.4 × Conso12M) / 30
Demande (NEW)     = (Conso3M / 90) × 1.2
Safety Stock (SS) = Z × σ × √(Lead Time)
ROP               = (Demande × Lead Time) + SS
Min               = ROP
Max               = ROP + Demande × Période de révision
Recommandation    = si Projeté < Min → Commander (Max − Projeté)
```

**Z-scores par niveau de service :**
- 90% → z = 1.28
- 95% → z = 1.65
- 98% → z = 2.05

---

## 🗺️ Architecture des fichiers

```
lovable-core/
├── sop-engine/                    # Moteur S&OP (TypeScript pur)
│   ├── services/
│   │   ├── sopEngineAdaptive.ts   # Moteur principal (NEW/MATURE/OBSOLETE)
│   │   ├── sopEngine.ts           # Moteur legacy (SKUs avec historique complet)
│   │   ├── explainEngine.ts       # Explications langage naturel
│   │   ├── aiAssistant.ts         # Placeholder AI + narratives
│   │   ├── calculations.ts        # Fonctions mathématiques S&OP
│   │   ├── prioritizationEngine.ts # Score de priorité/risque
│   │   ├── kpiEngine.ts           # KPIs agrégés
│   │   └── ...
│   └── components/                # Composants React démo (standalone)
├── src/
│   ├── routes/
│   │   ├── dashboard.sop-demo.tsx # ✨ Démo S&OP complète
│   │   ├── dashboard.skus.tsx     # Gestion SKUs
│   │   ├── dashboard.index.tsx    # Vue globale
│   │   └── ...
│   └── lib/
│       ├── optimizer.ts           # Algorithme d'optimisation
│       └── demo-seed.ts           # Données de démo Supabase
└── README.md
```

---

## 🔌 Axes d'extension

### 1. Connexion AI réelle
Remplacer le placeholder dans `aiAssistant.ts` par un appel API (OpenAI, Anthropic, Mistral...).

### 2. Intégration données réelles
- Import CSV / XLSX (déjà fonctionnel dans `/dashboard/skus`)
- Connexion ERP via API REST
- Webhook Supabase pour sync temps réel

### 3. Segmentation ABC/XYZ
Le moteur est prêt à recevoir une couche de segmentation automatique basée sur la valeur annuelle (ABC) et la variabilité (XYZ).

### 4. Alertes automatiques
Connecter les `recommendation.action === "ORDER"` à un système d'alertes email/Slack via Supabase Edge Functions.

### 5. Multi-entrepôt / Multi-site
Étendre le schéma SKU avec `site_id` et recalculer par site de stockage.

---

## 🧪 Données de démo

Depuis la Vue Globale (`/dashboard`), cliquer sur **"Charger les données de démo"** pour générer 10 SKUs avec :
- 30 jours d'historique de demande quotidien
- 12 mois d'historique mensuel
- Prévisions 3 mois
- Statuts variés (optimal, alerte, surstock)

La démo S&OP (`/dashboard/sop-demo`) fonctionne **sans base de données** avec des données mockées entièrement en mémoire.

---

## 📄 Licence

Propriétaire — usage interne et démonstration client uniquement.
