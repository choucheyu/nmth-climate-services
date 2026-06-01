export interface NumberStats {
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  stddev: number | null;
}

export function summarizeNumbers(values: number[]): NumberStats {
  if (values.length === 0) {
    return { count: 0, average: null, min: null, max: null, stddev: null };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  const average = sum / values.length;
  const variance = values.reduce((acc, value) => acc + (value - average) ** 2, 0) / values.length;
  return {
    count: values.length,
    average,
    min: Math.min(...values),
    max: Math.max(...values),
    stddev: Math.sqrt(variance)
  };
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}
