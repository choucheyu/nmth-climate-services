export const REPORT_TEMPERATURE_AXIS = {
  min: 0,
  max: 35,
  interval: 5,
  tickCount: 8
} as const;

export const REPORT_HUMIDITY_AXIS = {
  min: 0,
  max: 70,
  interval: 10,
  tickCount: 8
} as const;

export const REPORT_ROUNDING_RULE = "temperature and humidity are rounded to exactly 1 decimal place using normal rounding";

export function roundClimateNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round((numeric + Number.EPSILON) * 10) / 10;
}

export function formatClimateValue(value: unknown, emptyValue = ""): string {
  const rounded = roundClimateNumber(value);
  return rounded === null ? emptyValue : rounded.toFixed(1);
}
