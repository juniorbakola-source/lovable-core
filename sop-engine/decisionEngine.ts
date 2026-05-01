export function generateRecommendation(data: {
  projected: number;
  rop: number;
  eoq: number;
  moq: number;
}) {
  if (data.projected < data.rop) {
    return {
      action: "ORDER",
      quantity: Math.max(data.eoq, data.moq),
      message: `Order ${Math.max(data.eoq, data.moq)} units now to avoid stockout.`,
    };
  }

  return {
    action: "HOLD",
    message: "Stock level is sufficient",
  };
}
