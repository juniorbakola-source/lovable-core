export function explainDecision(input: {
  sku: string;
  projected: number;
  rop: number;
  recommendation: string;
}) {
  if (input.projected < input.rop) {
    return `SKU ${input.sku}: Risk of stockout. ${input.recommendation}`;
  }

  return `SKU ${input.sku}: Stock level is healthy.`;
}
