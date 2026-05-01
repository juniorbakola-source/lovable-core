// Génère un jeu de démo (10 SKUs réalistes avec 12 mois d'historique + forecast 3m)
// Inspiré du dataset FlowStockAI

import { supabase } from "@/integrations/supabase/client";

const DEMO = [
  { sku_code: "BAT-5000", name: "Batterie Lithium 5000mAh", category: "Composants", unit_cost: 13, lead_time_days: 21, moq: 500, stock: 242, on_order: 0 },
  { sku_code: "DISP-096", name: 'Ecran OLED 0.96"', category: "Electronique", unit_cost: 4, lead_time_days: 14, moq: 1000, stock: 748, on_order: 0 },
  { sku_code: "MCU-ESP32", name: "Module ESP32-WROOM", category: "Electronique", unit_cost: 4, lead_time_days: 30, moq: 1000, stock: 2767, on_order: 0 },
  { sku_code: "CASE-ALU", name: "Boîtier Aluminium Anodisé", category: "Boîtiers", unit_cost: 18, lead_time_days: 45, moq: 200, stock: 2942, on_order: 0 },
  { sku_code: "CBL-USB-C", name: "Câble USB-C Tressé 1m", category: "Accessoires", unit_cost: 2, lead_time_days: 10, moq: 2000, stock: 29, on_order: 2037 },
  { sku_code: "CHG-QC3", name: "Chargeur Mural QuickCharge 3.0", category: "Accessoires", unit_cost: 7, lead_time_days: 25, moq: 500, stock: 6843, on_order: 0 },
  { sku_code: "PCB-MAIN", name: "Carte Mère PCB 4 Couches", category: "Composants", unit_cost: 9, lead_time_days: 28, moq: 300, stock: 2792, on_order: 0 },
  { sku_code: "ANT-WIFI", name: "Antenne Wi-Fi 2.4GHz PCB", category: "Composants", unit_cost: 1, lead_time_days: 7, moq: 5000, stock: 1186, on_order: 0 },
  { sku_code: "KEY-MECH", name: "Commutateur Mécanique (10pcs)", category: "Accessoires", unit_cost: 22, lead_time_days: 35, moq: 100, stock: 4479, on_order: 0 },
  { sku_code: "SCR-M3", name: "Vis M3 Inox (sachet 100)", category: "Quincaillerie", unit_cost: 3, lead_time_days: 5, moq: 1000, stock: 8200, on_order: 0 },
];

function genHistory(baseDaily: number, seasonality = 0.3): { yearly: number[]; recent: number[]; forecast: number[] } {
  const yearly: number[] = [];
  for (let m = 0; m < 12; m++) {
    const seasonal = 1 + seasonality * Math.sin((m / 12) * Math.PI * 2);
    const noise = 0.85 + Math.random() * 0.3;
    yearly.push(Math.round(baseDaily * 30 * seasonal * noise));
  }
  // Last 10 days proxy
  const recent: number[] = [];
  for (let d = 0; d < 10; d++) {
    recent.push(Math.max(0, Math.round(baseDaily * (0.7 + Math.random() * 0.6))));
  }
  // Next 3 months forecast (slight uptrend)
  const forecast: number[] = [];
  const lastSeasonal = yearly[11] / 30;
  for (let m = 0; m < 3; m++) {
    forecast.push(Math.round(lastSeasonal * 30 * (1.05 + m * 0.02) * (0.95 + Math.random() * 0.1)));
  }
  return { yearly, recent, forecast };
}

export async function seedDemoData(userId: string): Promise<{ inserted: number }> {
  const rows = DEMO.map((d) => {
    // baseDaily inferred from realistic ranges per category
    const baseDaily =
      d.category === "Accessoires" ? 60 :
      d.category === "Electronique" ? 35 :
      d.category === "Composants" ? 25 :
      d.category === "Boîtiers" ? 15 : 50;
    const { yearly, recent, forecast } = genHistory(baseDaily);
    return {
      user_id: userId,
      sku_code: d.sku_code,
      name: d.name,
      category: d.category,
      stock: d.stock,
      on_order: d.on_order,
      in_production: 0,
      lead_time_days: d.lead_time_days,
      moq: d.moq,
      unit_cost: d.unit_cost,
      service_level: 0.95,
      demand_history: recent,
      demand_history_yearly: yearly,
      forecast_3m: forecast,
    };
  });
  const { error } = await supabase.from("skus").insert(rows);
  if (error) throw error;
  return { inserted: rows.length };
}
