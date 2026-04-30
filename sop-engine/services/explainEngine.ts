export function explainDecision(sku: any) {
  const reasons: string[] = [];

  if (sku.projected < sku.rop) {
    reasons.push("Stock below reorder point → replenishment required");
  }

  if (sku.lifecycle === "NEW") {
    reasons.push("New SKU → higher uncertainty → increased safety stock");
  }

  if (sku.projected > sku.max) {
    reasons.push("Overstock detected → reduce or stop ordering");
  }

  return {
    reasons,
    risk: sku.projected < sku.rop ? "HIGH" : "LOW",
    confidence: sku.lifecycle === "MATURE" ? 0.9 : 0.6
  };
}
