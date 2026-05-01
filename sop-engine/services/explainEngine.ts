export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ExplainResult {
  summary: string;
  reasons: string[];
  advice: string;
  risk: RiskLevel;
  confidence: number;
  warning?: string;
}

export function explainDecision(sku: any): ExplainResult {
  const reasons: string[] = [];
  let risk: RiskLevel = "LOW";
  let advice = "";
  let warning: string | undefined;

  // ── Lifecycle analysis ──────────────────────────────────────────────────────
  if (sku.lifecycle === "NEW") {
    reasons.push(
      "New SKU with limited demand history — safety stock has been automatically increased to reduce launch risk.",
    );
    warning =
      "⚠️ NEW SKU: Demand patterns are uncertain. Review parameters weekly for the first 3 months.";
  } else if (sku.lifecycle === "OBSOLETE") {
    reasons.push(
      "Demand has dropped >70% vs. the 12-month trend — this SKU is entering its end-of-life phase.",
    );
    warning =
      "⚠️ OBSOLETE SKU: Avoid new replenishment orders. Consider liquidation or demand transfer.";
  } else {
    reasons.push("Mature SKU with reliable 12-month demand history — forecast confidence is high.");
  }

  // ── Stock level analysis ────────────────────────────────────────────────────
  if (sku.projected < sku.rop) {
    risk = "HIGH";
    reasons.push(
      `Projected stock (${Math.round(sku.projected)}) is below the Reorder Point (${Math.round(sku.rop)}) — a stockout risk exists within the lead time window.`,
    );
    advice =
      sku.lifecycle === "NEW"
        ? "Order now and monitor demand weekly. Safety stock is elevated to absorb forecast error."
        : "Trigger replenishment immediately. Stock will cover the lead time only with safety buffer.";
  } else if (sku.projected < sku.min) {
    risk = "MEDIUM";
    reasons.push(
      `Stock is below the Min level (${Math.round(sku.min)}) — replenishment should be planned in the next review cycle.`,
    );
    advice = "Schedule a replenishment order before the next S&OP cycle to avoid a gap.";
  } else if (sku.projected > sku.max * 1.5) {
    risk = sku.lifecycle === "OBSOLETE" ? "HIGH" : "MEDIUM";
    reasons.push(
      `Stock level (${Math.round(sku.projected)}) significantly exceeds the Max (${Math.round(sku.max)}) — working capital is over-allocated.`,
    );
    advice =
      sku.lifecycle === "OBSOLETE"
        ? "Reduce stock urgently: consider markdown pricing, return to supplier, or transfer to another site."
        : "Pause ordering until stock normalises. Review demand forecast for accuracy.";
  } else {
    reasons.push(
      `Stock (${Math.round(sku.projected)}) is within the safe Min–Max corridor — no action required.`,
    );
    advice = "Maintain current replenishment policy. Next review at the standard S&OP cycle.";
  }

  // ── Demand signal quality ───────────────────────────────────────────────────
  const cv = sku.sigma > 0 && sku.avgDemand > 0 ? sku.sigma / sku.avgDemand : 0;
  if (cv > 0.5) {
    reasons.push(
      `High demand variability detected (CV=${cv.toFixed(2)}) — safety stock formula uses a conservative z-score to compensate.`,
    );
  }

  const summary = buildSummary(sku, risk);
  const confidence = sku.lifecycle === "MATURE" ? 0.9 : 0.6;

  return { summary, reasons, advice, risk, confidence, warning };
}

function buildSummary(sku: any, risk: RiskLevel): string {
  const name = sku.name || sku.skuCode || "SKU";
  const riskLabel =
    risk === "HIGH" ? "🔴 HIGH RISK" : risk === "MEDIUM" ? "🟡 MEDIUM RISK" : "🟢 OK";

  if (sku.lifecycle === "OBSOLETE") {
    return `${name} [OBSOLETE] ${riskLabel} — Demand declining. Avoid replenishment; plan inventory wind-down.`;
  }
  if (sku.lifecycle === "NEW") {
    return `${name} [NEW] ${riskLabel} — Limited history; conservative safety stock applied. Monitor weekly.`;
  }
  if (risk === "HIGH") {
    return `${name} [MATURE] ${riskLabel} — Immediate replenishment required to prevent stockout.`;
  }
  if (risk === "MEDIUM") {
    return `${name} [MATURE] ${riskLabel} — Plan replenishment in the next S&OP cycle.`;
  }
  return `${name} [MATURE] ${riskLabel} — Stock levels are healthy and within parameters.`;
}
