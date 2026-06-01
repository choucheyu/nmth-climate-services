type AlertsTableParams = {
  current?: number;
  pageSize?: number;
  status?: unknown;
  level?: unknown;
  type?: unknown;
  deviceId?: unknown;
};

function normalizeFilter(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === "all") {
    return undefined;
  }
  return normalized;
}

export function buildAlertsListPath(params: AlertsTableParams) {
  const query = new URLSearchParams();
  query.set("page", String(params.current ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  for (const key of ["status", "level", "type", "deviceId"] as const) {
    const value = normalizeFilter(params[key]);
    if (value) {
      query.set(key, value);
    }
  }
  return `/alerts?${query.toString()}`;
}
