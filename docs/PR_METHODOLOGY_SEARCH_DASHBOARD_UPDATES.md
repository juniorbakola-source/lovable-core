# Mise à jour globale — Méthodologie, calculs et dashboards interactifs

## Objectifs

Cette mise à jour standardise les calculs utilisés dans tous les modules de l’application FlowStockAI :

- Dashboard global
- SKUs
- Forecasting
- Solver Engine
- Optimizer
- What-If
- POS
- Silvery Engine

Elle ajoute également :

- des mécanismes de recherche et filtres avancés ;
- des cartes KPI interactives ;
- des drill-downs entre dashboards et données détaillées ;
- une harmonisation des formules métier ;
- une meilleure cohérence entre les calculs IA et les calculs opérationnels.

---

# Méthodologie harmonisée

## Demande journalière pondérée

Nouvelle logique commune :

```text
Daily Demand =
55% Forecast 3 mois
+ 30% Historique annuel
+ 15% Historique court terme
```

Objectif :

- privilégier les signaux futurs ;
- conserver la saisonnalité ;
- rester réactif aux tendances récentes.

---

## Pipeline d’approvisionnement

Le pipeline devient :

```text
Pipeline = on_order + in_production
```

Le pipeline est maintenant utilisé dans :

- Solver
- Dashboard
- Optimizer
- What-If
- Forecasting

---

## Stock de sécurité

```text
Safety Stock = Z × σ × √LeadTime
```

Avec :

- Z = niveau de service
- σ = variabilité journalière
- LeadTime = délai fournisseur

---

## Point de commande (ROP)

```text
ROP = Lead Demand + Safety Stock
```

---

## Inventaire projeté

```text
Projected Inventory = Stock + Pipeline − Lead Demand
```

---

## Quantité recommandée

Nouvelle logique :

```text
Recommended Order = quantité nécessaire pour couvrir 30 jours
```

avec :

- respect du MOQ ;
- arrondi automatique ;
- prise en compte du pipeline réel.

---

# Recherche & filtres

## Ajouts demandés

### Dashboard global

- recherche rapide SKU ;
- filtre par statut ;
- filtre par catégorie ;
- filtre par criticité ;
- accès direct aux pages détaillées.

### Solver

- recherche SKU ;
- filtre « urgent » ;
- filtre « rupture » ;
- filtre « surstock ».

### Forecasting

- recherche produit ;
- filtre par horizon ;
- filtre par variabilité.

### What-If

- sauvegarde de scénarios ;
- recherche par simulation ;
- comparaison multi-scénarios.

---

# Dashboards interactifs

## KPI Cards cliquables

Les cartes KPI doivent renvoyer vers :

- SKUs filtrés ;
- Solver ;
- Forecasting ;
- POS ;
- Optimizer.

---

## Drill-down analytics

Ajout des comportements suivants :

- clic sur graphique → ouverture liste filtrée ;
- clic sur statut → affichage des SKUs concernés ;
- clic sur catégorie → détail catégorie ;
- clic sur alertes → accès direct aux recommandations.

---

# Modules à mettre à jour

## dashboard.index.tsx

- rendre les KPI interactifs ;
- ajouter drill-down ;
- ajouter recherche rapide.

## dashboard.skus.tsx

- améliorer filtres ;
- synchronisation URL/search params ;
- filtres persistants.

## dashboard.forecasting.tsx

- ajout recherche ;
- ajout navigation interactive.

## dashboard.solver.tsx

- ajout drill-down ;
- harmonisation formules.

## dashboard.whatif.tsx

- ajout comparaison scénarios ;
- ajout recherche.

## dashboard.methodologie.tsx

- documentation des nouvelles formules ;
- explication des pondérations ;
- documentation pipeline.

---

# Résultat attendu

Cette mise à jour doit permettre :

- une cohérence totale des calculs ;
- des analyses plus fiables ;
- une meilleure expérience utilisateur ;
- des dashboards réellement navigables ;
- une meilleure compréhension des recommandations IA.
