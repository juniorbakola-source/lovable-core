export function computeFinancials(sku: any) {
  const holdingCostRate = 0.2;

  const holdingCost = sku.projected * sku.unitCost * holdingCostRate;
  const stockoutCost = Math.max(0, sku.rop - sku.projected) * sku.unitCost * 1.5;
  const overstock = Math.max(0, sku.projected - sku.max);
  const overstockCost = overstock * sku.unitCost;

  return {
    holdingCost,
    stockoutCost,
    overstockCost,
    totalImpact: holdingCost + stockoutCost + overstockCost
  };
}
