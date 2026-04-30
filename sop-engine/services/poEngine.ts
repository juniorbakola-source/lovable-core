export function generatePOs(skus: any[]) {
  const orders = skus.filter(s => s.recommendation?.action === "ORDER");

  return orders.map(sku => ({
    supplier: sku.supplier || "default",
    sku: sku.sku,
    quantity: sku.recommendation.quantity,
    totalCost: (sku.unitCost || 0) * sku.recommendation.quantity
  }));
}

export function groupBySupplier(pos: any[]) {
  return pos.reduce((acc: any, po: any) => {
    if (!acc[po.supplier]) acc[po.supplier] = [];
    acc[po.supplier].push(po);
    return acc;
  }, {});
}
