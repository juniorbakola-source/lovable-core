export function computePriorityScore(sku: any) {
  const riskScore = sku.projected < sku.rop ? 100 : 0;
  const valueScore = (sku.unitCost || 1) * (sku.avgDemand || 1);
  const urgencyFactor = sku.lifecycle === "NEW" ? 1.2 : 1;

  return (riskScore + valueScore) * urgencyFactor;
}
