import { formatClimateValue, type DataProfile, type ReportExportContent, type SamplingInterval } from "@nmth/shared";

export type ReportRow = {
  measuredAt: string;
  date?: string;
  time?: string;
  deviceId?: string;
  exhibition?: string | null;
  zone?: string | null;
  point?: string | null;
  deviceName: string;
  displayName?: string;
  dehumidifySetpoint?: number | null;
  temperatureC?: number | null;
  humidityPercent?: number | null;
  source?: string;
  dataProfile?: string;
  qualityFlags?: unknown;
};

export type ReportDevice = {
  id: string;
  deviceName: string;
  displayName: string;
  exhibitionId?: string | null;
  zoneId?: string | null;
  dataProfile?: DataProfile;
  enabled?: boolean;
  lastSeenAt?: string | Date | null;
};

export type ReportQueryParamsInput = {
  start: string;
  end: string;
  interval: SamplingInterval | string;
  dataProfile?: DataProfile | string;
  exhibitionId?: string;
  zoneId?: string;
  deviceIds?: string[];
  source?: string;
  includeCompensated: boolean;
  includeSynthetic: boolean;
  timezone?: string;
  format?: "csv" | "xlsx" | "pdf";
  exportContent?: ReportExportContent;
  locale?: string;
  reportTitle?: string;
};

export type ReportSummary = {
  rowCount: number;
  deviceCount: number;
  effectiveStart?: string;
  effectiveEnd?: string;
  offlineCount: number;
  noDataCount: number;
  partialCount: number;
  perDevice: Array<{
    key: string;
    deviceName: string;
    displayName: string;
    source: string;
    count: number;
    averageTemperature: string;
    minimumTemperature: string;
    maximumTemperature: string;
    averageHumidity: string;
    minimumHumidity: string;
    maximumHumidity: string;
    status: "ok" | "partial" | "noData" | "offline";
    coveragePercent?: number;
  }>;
};

export type CrossAnalysisDevice = {
  key: string;
  label: string;
};

export type CrossAnalysisRow = {
  key: string;
  measuredAt: string;
  source: string;
  values: Record<string, ReportRow[]>;
};

export const REPORT_NO_AUTO_QUERY_MARKER = "NMTH_REPORTS_NO_AUTO_FULL_QUERY";
const OFFLINE_AFTER_MS = 3 * 60_000;

export function buildReportQueryParams(input: ReportQueryParamsInput): URLSearchParams {
  const params = new URLSearchParams({
    start: input.start,
    end: input.end,
    interval: String(input.interval),
    includeCompensated: String(input.includeCompensated),
    includeSynthetic: String(input.includeSynthetic)
  });
  if (input.dataProfile) params.set("dataProfile", input.dataProfile);
  if (input.exhibitionId) params.set("exhibitionId", input.exhibitionId);
  if (input.zoneId) params.set("zoneId", input.zoneId);
  for (const deviceId of input.deviceIds ?? []) {
    params.append("deviceIds", deviceId);
  }
  if (input.source) params.set("source", input.source);
  if (input.timezone) params.set("timezone", input.timezone);
  if (input.format) params.set("format", input.format);
  if (input.exportContent) params.set("exportContent", input.exportContent);
  if (input.locale) params.set("locale", input.locale);
  if (input.reportTitle) params.set("reportTitle", input.reportTitle);
  return params;
}

export function formatReportClimateValue(value: unknown): string {
  return formatClimateValue(value, "-");
}

export function buildDeviceNameSummary(devices: ReportDevice[], selectedDeviceIds: string[], fallbackLabel: string): string {
  const selected = selectedDeviceIds.length ? devices.filter((device) => selectedDeviceIds.includes(device.id)) : [];
  if (!selected.length) {
    return fallbackLabel;
  }
  const labels = selected.map((device) => `${device.displayName} (${device.deviceName})`);
  if (labels.length <= 3) {
    return labels.join(", ");
  }
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

export function hasSelectedReportDevices(values: { deviceId?: string; deviceIds?: string[] } | null | undefined): boolean {
  return Boolean(values?.deviceId || values?.deviceIds?.length);
}

export function computeReportSummary({
  rows,
  devices,
  selectedDeviceIds,
  start,
  end,
  interval,
  now = new Date()
}: {
  rows: ReportRow[];
  devices: ReportDevice[];
  selectedDeviceIds: string[];
  start: Date;
  end: Date;
  interval: string;
  now?: Date;
}): ReportSummary {
  const candidateDevices = selectedDeviceIds.length ? devices.filter((device) => selectedDeviceIds.includes(device.id)) : devices;
  const deviceById = new Map(candidateDevices.map((device) => [device.id, device]));
  for (const row of rows) {
    if (row.deviceId && !deviceById.has(row.deviceId)) {
      deviceById.set(row.deviceId, {
        id: row.deviceId,
        deviceName: row.deviceName,
        displayName: row.displayName ?? row.deviceName
      });
    }
  }

  const expectedBuckets = expectedBucketCount(start, end, interval);
  const groupedRows = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const deviceKey = row.deviceId ?? row.deviceName;
    const source = row.source ?? "-";
    const key = `${deviceKey}::${source}`;
    groupedRows.set(key, [...(groupedRows.get(key) ?? []), row]);
  }

  const perDevice = Array.from(deviceById.values()).flatMap((device) => {
    const deviceRows = Array.from(groupedRows.entries())
      .filter(([key]) => key.startsWith(`${device.id}::`) || key.startsWith(`${device.deviceName}::`))
      .map(([key, items]) => ({ source: key.split("::")[1] ?? "-", items }));
    const groups = deviceRows.length ? deviceRows : [{ source: "-", items: [] as ReportRow[] }];
    return groups.map(({ source, items }) => {
      const coveragePercent = expectedBuckets ? Math.min(100, Math.round((items.length / expectedBuckets) * 100)) : undefined;
      const status = deviceStatus(device, items.length, coveragePercent, now);
      return {
        key: `${device.id}::${source}`,
        deviceName: device.deviceName,
        displayName: device.displayName,
        source,
        count: items.length,
        averageTemperature: formatReportClimateValue(average(items.map((row) => row.temperatureC))),
        minimumTemperature: formatReportClimateValue(min(items.map((row) => row.temperatureC))),
        maximumTemperature: formatReportClimateValue(max(items.map((row) => row.temperatureC))),
        averageHumidity: formatReportClimateValue(average(items.map((row) => row.humidityPercent))),
        minimumHumidity: formatReportClimateValue(min(items.map((row) => row.humidityPercent))),
        maximumHumidity: formatReportClimateValue(max(items.map((row) => row.humidityPercent))),
        status,
        coveragePercent
      };
    });
  });

  const measuredTimes = rows.map((row) => new Date(row.measuredAt).getTime()).filter(Number.isFinite);
  return {
    rowCount: rows.length,
    deviceCount: deviceById.size,
    effectiveStart: measuredTimes.length ? new Date(Math.min(...measuredTimes)).toISOString() : undefined,
    effectiveEnd: measuredTimes.length ? new Date(Math.max(...measuredTimes)).toISOString() : undefined,
    offlineCount: perDevice.filter((item) => item.status === "offline").length,
    noDataCount: perDevice.filter((item) => item.status === "noData").length,
    partialCount: perDevice.filter((item) => item.status === "partial").length,
    perDevice
  };
}

export function buildCrossAnalysis(rows: ReportRow[]): { devices: CrossAnalysisDevice[]; rows: CrossAnalysisRow[] } {
  const devices = Array.from(
    rows
      .reduce((map, row) => {
        const key = row.deviceId ?? row.deviceName;
        if (!map.has(key)) {
          map.set(key, { key, label: `${row.displayName ?? row.deviceName} (${row.deviceName})` });
        }
        return map;
      }, new Map<string, CrossAnalysisDevice>())
      .values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const buckets = new Map<string, CrossAnalysisRow>();
  for (const row of rows) {
    const source = row.source ?? "-";
    const key = `${row.measuredAt}::${source}`;
    const bucket = buckets.get(key) ?? { key, measuredAt: row.measuredAt, source, values: {} };
    const deviceKey = row.deviceId ?? row.deviceName;
    bucket.values[deviceKey] = [...(bucket.values[deviceKey] ?? []), row];
    buckets.set(key, bucket);
  }
  return {
    devices,
    rows: Array.from(buckets.values()).sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
  };
}

export function exportDisabledReason(input: {
  canExport: boolean;
  hasReportValues: boolean;
  isLoading: boolean;
  hasError: boolean;
  rowCount: number;
}): "noPermission" | "notReady" | "loading" | "queryFailed" | "noData" | null {
  if (!input.canExport) return "noPermission";
  if (!input.hasReportValues) return "notReady";
  if (input.isLoading) return "loading";
  if (input.hasError) return "queryFailed";
  if (input.rowCount === 0) return "noData";
  return null;
}

export function isLargeReportQuery(start: Date, end: Date, deviceCount: number): boolean {
  const days = Math.max(0, end.getTime() - start.getTime()) / 86_400_000;
  return deviceCount >= 20 || days >= 31 || deviceCount * Math.max(1, days) >= 120;
}

function expectedBucketCount(start: Date, end: Date, interval: string): number | undefined {
  const ms = intervalMs(interval);
  if (!ms) {
    return undefined;
  }
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / ms) + 1);
}

function intervalMs(interval: string): number | undefined {
  const map: Record<string, number> = {
    "5m": 5 * 60_000,
    "10m": 10 * 60_000,
    "30m": 30 * 60_000,
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000
  };
  return map[interval];
}

function deviceStatus(device: ReportDevice, rowCount: number, coveragePercent: number | undefined, now: Date): "ok" | "partial" | "noData" | "offline" {
  if (isOffline(device, now)) {
    return "offline";
  }
  if (rowCount === 0) {
    return "noData";
  }
  if (coveragePercent !== undefined && coveragePercent < 80) {
    return "partial";
  }
  return "ok";
}

function isOffline(device: ReportDevice, now: Date): boolean {
  if (device.enabled === false) {
    return true;
  }
  if (!device.lastSeenAt) {
    return false;
  }
  const lastSeenAt = typeof device.lastSeenAt === "string" ? new Date(device.lastSeenAt) : device.lastSeenAt;
  return Number.isFinite(lastSeenAt.getTime()) && now.getTime() - lastSeenAt.getTime() > OFFLINE_AFTER_MS;
}

function numbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(values: Array<number | null | undefined>): number | null {
  const finite = numbers(values);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function min(values: Array<number | null | undefined>): number | null {
  const finite = numbers(values);
  return finite.length ? Math.min(...finite) : null;
}

function max(values: Array<number | null | undefined>): number | null {
  const finite = numbers(values);
  return finite.length ? Math.max(...finite) : null;
}
