export function computeKPIs(data: any[]) {
  const totalValue = data.reduce((sum, sku) => sum + (sku.value || 0), 0);
  const riskSKUs = data.filter(sku => sku.projected < sku.rop).length;
  const orders = data.filter(sku => sku.recommendation?.action === "ORDER").length;

  return {
    totalValue,
    riskSKUs,
    orders,
    activePO: data.filter(sku => sku.onOrder > 0).length
  };
}
