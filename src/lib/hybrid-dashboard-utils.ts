export type VolatilityBand = "low" | "medium" | "high";

export function getVolatilityBand(ratio: number): VolatilityBand {
  if (!Number.isFinite(ratio) || ratio <= 0.2) return "low";
  if (ratio <= 0.35) return "medium";
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
