export const DEFAULT_CURRENCY = "USD";

export function formatCurrency(value: number, currency: string = DEFAULT_CURRENCY) {
  return `${currency} ${value.toFixed(2)}`;
}
