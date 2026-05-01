export function computeRiskScore(sku: any) {
  let score = 0;

  if (sku.projected < sku.rop) score += 50;
  if (sku.value > 10000) score += 20;
  if (sku.variability > 0.3) score += 20;
  if (sku.leadTime > 10) score += 10;

  return score;
}

export function classifyABC(value: number) {
  if (value > 10000) return "A";
  if (value > 5000) return "B";
  return "C";
}
