export type VolatilityBand = "low" | "medium" | "high";

const LOW_VOLATILITY_THRESHOLD = 0.2;
const MEDIUM_VOLATILITY_THRESHOLD = 0.35;

export function getVolatilityBand(ratio: number): VolatilityBand {
  if (!Number.isFinite(ratio) || ratio <= LOW_VOLATILITY_THRESHOLD) return "low";
  if (ratio <= MEDIUM_VOLATILITY_THRESHOLD) return "medium";
  return "high";
}

export function escapeCsvCell(value: unknown): string {
  const nullByte = String.fromCharCode(0);
  const normalized = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(nullByte)
    .join("");
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}
