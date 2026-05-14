import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ─── Supported currencies ────────────────────────────────────────────────────
export const CURRENCIES = [
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "CAD", symbol: "CA$", label: "Dollar canadien" },
  { code: "GBP", symbol: "£", label: "Livre sterling" },
  { code: "CHF", symbol: "CHF", label: "Franc suisse" },
  { code: "MAD", symbol: "MAD", label: "Dirham marocain" },
  { code: "XOF", symbol: "CFA", label: "Franc CFA (UEMOA)" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

// ─── Supported languages ────────────────────────────────────────────────────
export const LANGUAGES = [
  { code: "fr", label: "Français", locale: "fr-FR" },
  { code: "en", label: "English", locale: "en-US" },
  { code: "es", label: "Español", locale: "es-ES" },
  { code: "ar", label: "العربية", locale: "ar-MA" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

// ─── Translation dictionary (minimal, UI labels only) ────────────────────────
const T: Record<LangCode, Record<string, string>> = {
  fr: {
    "nav.overview": "Vue Globale",
    "nav.skus": "Gestion SKUs",
    "nav.silvery": "Silvery Engine",
    "nav.connectors": "Connecteurs",
    "nav.forecasting": "Séries Temporelles IA",
    "nav.solver": "Solveur Engine",
    "nav.optimizer": "Inventory Optimizer",
    "nav.hybrid": "Analyse Hybride",
    "nav.whatif": "Analyse What-If",
    "nav.pos": "Bons de Commande",
    "nav.methodology": "Méthodologie & Formules",
    "nav.settings": "Paramètres",
    "action.logout": "Déconnexion",
    "settings.title": "Paramètres Compte & Organisation",
    "settings.locale": "Langue & Devise",
    "settings.language": "Langue de l'interface",
    "settings.currency": "Devise par défaut",
    "overview.title": "Tableau de bord",
    "overview.subtitle": "Vue globale des stocks et opérations — flux temps réel.",
    "overview.total_value": "Valeur totale du stock",
    "overview.critical": "Risques ruptures (Urgent)",
    "overview.reorder": "Commandes recommandées",
    "overview.po_active": "Commandes en cours (PO)",
    "common.loading": "Chargement…",
    "common.per_month": "/ mois",
  },
  en: {
    "nav.overview": "Overview",
    "nav.skus": "SKU Management",
    "nav.silvery": "Silvery Engine",
    "nav.connectors": "Connectors",
    "nav.forecasting": "AI Time Series",
    "nav.solver": "Solver Engine",
    "nav.optimizer": "Inventory Optimizer",
    "nav.hybrid": "Hybrid Analysis",
    "nav.whatif": "What-If Analysis",
    "nav.pos": "Purchase Orders",
    "nav.methodology": "Methodology & Formulas",
    "nav.settings": "Settings",
    "action.logout": "Sign Out",
    "settings.title": "Account & Organization Settings",
    "settings.locale": "Language & Currency",
    "settings.language": "Interface language",
    "settings.currency": "Default currency",
    "overview.title": "Dashboard",
    "overview.subtitle": "Global view of stock & operations — real-time sync.",
    "overview.total_value": "Total Stock Value",
    "overview.critical": "Stockout Risks (Urgent)",
    "overview.reorder": "Recommended Orders",
    "overview.po_active": "Active POs",
    "common.loading": "Loading…",
    "common.per_month": "/ month",
  },
  es: {
    "nav.overview": "Vista General",
    "nav.skus": "Gestión SKUs",
    "nav.silvery": "Silvery Engine",
    "nav.connectors": "Conectores",
    "nav.forecasting": "Series Temporales IA",
    "nav.solver": "Motor Solvente",
    "nav.optimizer": "Optimizador de Inventario",
    "nav.hybrid": "Análisis Híbrido",
    "nav.whatif": "Análisis What-If",
    "nav.pos": "Órdenes de Compra",
    "nav.methodology": "Metodología y Fórmulas",
    "nav.settings": "Configuración",
    "action.logout": "Cerrar sesión",
    "settings.title": "Configuración de Cuenta y Organización",
    "settings.locale": "Idioma y Moneda",
    "settings.language": "Idioma de la interfaz",
    "settings.currency": "Moneda por defecto",
    "overview.title": "Panel de control",
    "overview.subtitle": "Vista global de stocks y operaciones — sincronización en tiempo real.",
    "overview.total_value": "Valor total del stock",
    "overview.critical": "Riesgos de ruptura (Urgente)",
    "overview.reorder": "Pedidos recomendados",
    "overview.po_active": "POs activos",
    "common.loading": "Cargando…",
    "common.per_month": "/ mes",
  },
  ar: {
    "nav.overview": "نظرة عامة",
    "nav.skus": "إدارة المنتجات",
    "nav.silvery": "محرك Silvery",
    "nav.connectors": "الموصلات",
    "nav.forecasting": "السلاسل الزمنية",
    "nav.solver": "محرك الحل",
    "nav.optimizer": "محسن المخزون",
    "nav.hybrid": "تحليل هجين",
    "nav.whatif": "تحليل ماذا لو",
    "nav.pos": "أوامر الشراء",
    "nav.methodology": "المنهجية والصيغ",
    "nav.settings": "الإعدادات",
    "action.logout": "تسجيل الخروج",
    "settings.title": "إعدادات الحساب والمؤسسة",
    "settings.locale": "اللغة والعملة",
    "settings.language": "لغة الواجهة",
    "settings.currency": "العملة الافتراضية",
    "overview.title": "لوحة القيادة",
    "overview.subtitle": "نظرة شاملة على المخزون والعمليات",
    "overview.total_value": "القيمة الإجمالية للمخزون",
    "overview.critical": "مخاطر النفاد (عاجل)",
    "overview.reorder": "طلبات مقترحة",
    "overview.po_active": "أوامر الشراء النشطة",
    "common.loading": "جارٍ التحميل…",
    "common.per_month": "/ شهر",
  },
};

// ─── Context ─────────────────────────────────────────────────────────────────

interface LocaleCtx {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  /** Translate a key, fallback to key itself */
  t: (key: string) => string;
  /** Format a number as currency */
  fc: (value: number, opts?: { decimals?: number }) => string;
  /** Format a number (no currency symbol) */
  fn: (value: number, opts?: { decimals?: number }) => string;
  /** Get the locale string for toLocaleString */
  locale: string;
  /** Get the currency symbol */
  currencySymbol: string;
}

const LocaleContext = createContext<LocaleCtx | null>(null);

const STORAGE_KEY = "flowstock_locale";

function loadStored(): { lang: LangCode; currency: CurrencyCode } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lang: parsed.lang ?? "fr",
        currency: parsed.currency ?? "USD",
      };
    }
  } catch {
    /* noop */
  }
  return { lang: "fr", currency: "USD" };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>("fr");
  const [currency, setCurrencyState] = useState<CurrencyCode>("USD");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadStored();
    setLangState(stored.lang);
    setCurrencyState(stored.currency);
    setHydrated(true);
  }, []);

  function persist(l: LangCode, c: CurrencyCode) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang: l, currency: c }));
    } catch {
      /* noop */
    }
  }

  function setLang(l: LangCode) {
    setLangState(l);
    persist(l, currency);
  }

  function setCurrency(c: CurrencyCode) {
    setCurrencyState(c);
    persist(lang, c);
  }

  const langDef = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  const currDef = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  function t(key: string): string {
    return T[lang]?.[key] ?? T.fr[key] ?? key;
  }

  function fc(value: number, opts?: { decimals?: number }): string {
    const d = opts?.decimals ?? 0;
    const formatted = value.toLocaleString(langDef.locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: 0,
    });
    // Place symbol before or after depending on currency convention
    if (currency === "EUR" || currency === "MAD" || currency === "XOF" || currency === "CHF") {
      return `${formatted} ${currDef.symbol}`;
    }
    return `${currDef.symbol}${formatted}`;
  }

  function fn(value: number, opts?: { decimals?: number }): string {
    const d = opts?.decimals ?? 0;
    return value.toLocaleString(langDef.locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: 0,
    });
  }

  if (!hydrated) return null;

  return (
    <LocaleContext.Provider
      value={{
        lang,
        setLang,
        currency,
        setCurrency,
        t,
        fc,
        fn,
        locale: langDef.locale,
        currencySymbol: currDef.symbol,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
