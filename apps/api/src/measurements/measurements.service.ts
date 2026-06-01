import { BadRequestException, Injectable } from "@nestjs/common";
import { reportQuerySchema, type DataProfile, type SamplingInterval } from "@nmth/shared";
import type { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import type { RequestUser } from "../common/current-user.decorator";
import { loadLatestMeasurementsByDevice, type LatestMeasurementByDevice } from "../common/latest-measurements";
import { summarizeNumbers } from "../common/statistics";
import { PrismaService } from "../prisma/prisma.service";

export interface ReportRow {
  measuredAt: Date;
  date: string;
  time: string;
  deviceId: string;
  exhibition: string | null;
  zone: string | null;
  point: string | null;
  deviceName: string;
  displayName: string;
  dehumidifySetpoint: number | null;
  temperatureC: number;
  humidityPercent: number;
  source: string;
  dataProfile: string;
  qualityFlags: unknown;
}

export interface OverviewAlertSource {
  deviceId: string;
  deviceName: string;
  displayName: string;
  lastSeenAt?: Date | null;
  alertIds: string[];
  alertTypes: string[];
  level?: string;
  reason?: string;
}

export interface LatestDeviceAlert {
  id: string;
  type: string;
  level: string;
  status: string;
  triggeredAt: Date;
  message: string;
  metadata: Prisma.JsonValue;
}

export interface LatestDeviceMeasurement {
  deviceId: string;
  deviceName: string;
  displayName: string;
  exhibitionId: string | null;
  zoneId: string | null;
  lastSeenAt: Date | null;
  latestMeasurement: LatestMeasurementByDevice | null;
  measurements: LatestMeasurementByDevice[];
  alerts: LatestDeviceAlert[];
  currentAlerts: LatestDeviceAlert[];
}

type ReportQuery = z.infer<typeof reportQuerySchema>;

const TREND_24H_DEVICE_REQUIRED_MARKER = "NMTH_TREND_24H_REQUIRES_DEVICE_SELECTION";
export const REPORT_MAX_SOURCE_ROWS = 50_000;
const CURRENT_ALERT_STATUSES = ["active", "acknowledged"] as const;
const CURRENT_ALERT_TYPES = [
  "humidity_threshold",
  "temperature_threshold",
  "device_offline",
] as const;
const LATEST_ALERT_SELECT = {
  id: true,
  type: true,
  level: true,
  status: true,
  triggeredAt: true,
  message: true,
  metadata: true,
} satisfies Prisma.AlertSelect;

@Injectable()
export class MeasurementsService {
  constructor(private readonly prisma: PrismaService) {}

  async latestOverview(exhibitionId?: string, requestedProfile?: DataProfile, user?: RequestUser) {
    assertScopedResourceIds(user, { exhibitionId });
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, requestedProfile);
    const thresholdAlertTypes = ["humidity_threshold", "temperature_threshold"];
    const devices = await this.prisma.device.findMany({
      where: { dataProfile, exhibitionId: scopedIdFilter(user, "exhibitionId", exhibitionId), zoneId: scopedIdFilter(user, "zoneId"), enabled: true, archivedAt: null },
      include: {
        exhibition: true,
        zone: true,
        alerts: {
          where: { dataProfile, status: { in: ["active", "acknowledged"] }, type: { in: [...thresholdAlertTypes, "device_offline"] } },
          orderBy: { triggeredAt: "desc" },
          take: 10
        }
      },
      orderBy: { deviceName: "asc" }
    });
    const latestMeasurements = await loadLatestMeasurementsByDevice(this.prisma, dataProfile, devices.map((device) => device.id));
    const latest = devices.map((device) => {
      const latestMeasurement = latestMeasurements.get(device.id) ?? null;
      return {
        ...device,
        latestMeasurement,
        measurements: latestMeasurement ? [latestMeasurement] : []
      };
    });
    const activeMeasurements = latest.map((device) => device.latestMeasurement).filter((value): value is NonNullable<typeof value> => Boolean(value));
    const temperature = summarizeNumbers(activeMeasurements.map((item) => item.temperatureC));
    const humidity = summarizeNumbers(activeMeasurements.map((item) => item.humidityPercent));
    const now = Date.now();
    const warningSources: OverviewAlertSource[] = [];
    const criticalSources: OverviewAlertSource[] = [];
    const offlineSources: OverviewAlertSource[] = [];
    const resolvedAlertIds: string[] = [];
    const resolutionUpdates: Promise<unknown>[] = [];
    const currentAlertsByDevice = new Map<string, (typeof latest)[number]["alerts"]>();

    for (const device of latest) {
      const offlineAlertIds = device.alerts.filter((alert) => alert.type === "device_offline" && alert.status === "active").map((alert) => alert.id);
      const isOffline = !device.lastSeenAt || now - device.lastSeenAt.getTime() > 3 * 60_000;
      if (isOffline) {
        offlineSources.push({
          deviceId: device.id,
          deviceName: device.deviceName,
          displayName: device.displayName,
          lastSeenAt: device.lastSeenAt,
          alertIds: offlineAlertIds,
          alertTypes: ["device_offline"],
          reason: "last_seen_stale"
        });
      }

      const activeCurrentThresholdAlerts: (typeof device)["alerts"] = [];
      for (const alert of device.alerts.filter((item) => thresholdAlertTypes.includes(item.type))) {
        const stillCurrent = device.latestMeasurement ? this.thresholdAlertStillCurrent(alert, device.latestMeasurement) : false;
        if (!stillCurrent) {
          resolvedAlertIds.push(alert.id);
          resolutionUpdates.push(this.resolveThresholdAlert(alert.id, device.latestMeasurement?.measuredAt ?? new Date()));
          continue;
        }
        if (alert.status === "active") {
          activeCurrentThresholdAlerts.push(alert);
        }
      }
      currentAlertsByDevice.set(device.id, activeCurrentThresholdAlerts);
      if (isOffline || !activeCurrentThresholdAlerts.length) {
        continue;
      }
      const source = {
        deviceId: device.id,
        deviceName: device.deviceName,
        displayName: device.displayName,
        lastSeenAt: device.lastSeenAt,
        alertIds: activeCurrentThresholdAlerts.map((alert) => alert.id),
        alertTypes: Array.from(new Set(activeCurrentThresholdAlerts.map((alert) => alert.type))),
        level: activeCurrentThresholdAlerts.some((alert) => alert.level === "critical") ? "critical" : "warning"
      };
      if (source.level === "critical") {
        criticalSources.push(source);
      } else {
        warningSources.push(source);
      }
    }

    await Promise.all(resolutionUpdates);
    const offline = offlineSources.length;
    const critical = criticalSources.length;
    const warning = warningSources.length;
    return {
      dataProfile,
      summary: {
        total: latest.length,
        normal: Math.max(0, latest.length - offline - critical - warning),
        warning,
        critical,
        offline,
        averageTemperature: temperature.average,
        averageHumidity: humidity.average
      },
      sources: {
        warning: warningSources,
        critical: criticalSources,
        offline: offlineSources,
        resolvedAlertIds
      },
      devices: latest.map((device) => ({
        ...device,
        currentAlerts: currentAlertsByDevice.get(device.id) ?? []
      }))
    };
  }

  async trend24h(query: { deviceId?: string; exhibitionId?: string; dataProfile?: string }, user?: RequestUser) {
    if (!query.deviceId) {
      throw new BadRequestException(TREND_24H_DEVICE_REQUIRED_MARKER);
    }
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.measurement.findMany({
      where: {
        dataProfile,
        measuredAt: { gte: start },
        deviceId: query.deviceId,
        exhibitionId: scopedIdFilter(user, "exhibitionId", query.exhibitionId),
        zoneId: scopedIdFilter(user, "zoneId"),
        source: { in: ["real", "imported", "compensated", "derived"] }
      },
      include: { device: true, exhibition: true, zone: true },
      orderBy: { measuredAt: "asc" },
      take: 10000
    });
  }

  async latestByDevice(
    query: {
      exhibitionId?: string;
      dataProfile?: string;
      deviceId?: string;
      deviceIds?: string | string[];
    },
    user?: RequestUser,
  ) {
    assertScopedResourceIds(user, { exhibitionId: query.exhibitionId });
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    const deviceIds = this.normalizeDeviceIds(query.deviceId, query.deviceIds);
    const devices = await this.prisma.device.findMany({
      where: {
        dataProfile,
        id: deviceIds.length ? { in: deviceIds } : undefined,
        exhibitionId: scopedIdFilter(user, "exhibitionId", query.exhibitionId),
        zoneId: scopedIdFilter(user, "zoneId"),
        enabled: true,
        archivedAt: null,
      },
      select: {
        id: true,
        deviceName: true,
        displayName: true,
        exhibitionId: true,
        zoneId: true,
        lastSeenAt: true,
        alerts: {
          where: {
            dataProfile,
            status: { in: [...CURRENT_ALERT_STATUSES] },
            type: { in: [...CURRENT_ALERT_TYPES] },
          },
          select: LATEST_ALERT_SELECT,
          orderBy: { triggeredAt: "desc" },
        },
      },
      orderBy: { deviceName: "asc" },
    });
    const latestMeasurements = await loadLatestMeasurementsByDevice(
      this.prisma,
      dataProfile,
      devices.map((device) => device.id),
    );
    const items: LatestDeviceMeasurement[] = devices.map((device) => {
      const latestMeasurement = latestMeasurements.get(device.id) ?? null;
      return {
        deviceId: device.id,
        deviceName: device.deviceName,
        displayName: device.displayName,
        exhibitionId: device.exhibitionId,
        zoneId: device.zoneId,
        lastSeenAt: device.lastSeenAt,
        latestMeasurement,
        measurements: latestMeasurement ? [latestMeasurement] : [],
        alerts: device.alerts,
        currentAlerts: device.alerts,
      };
    });
    return {
      dataProfile,
      generatedAt: new Date(),
      items,
    };
  }

  async reportRows(rawQuery: unknown, user?: RequestUser): Promise<ReportRow[]> {
    const query = this.parseReportQuery(rawQuery);
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    const sourceFilter = query.source
      ? [query.source]
      : [
          "real",
          "imported",
          ...(query.includeCompensated ? ["compensated"] : []),
          ...(query.includeSynthetic ? ["derived"] : []),
          "manual"
        ];
    const measurements = await this.prisma.measurement.findMany({
      where: {
        dataProfile,
        measuredAt: { gte: query.start, lte: query.end },
        exhibitionId: scopedIdFilter(user, "exhibitionId", query.exhibitionId),
        zoneId: scopedIdFilter(user, "zoneId", query.zoneId),
        deviceId: this.deviceIdFilter(query.deviceId, query.deviceIds),
        source: { in: sourceFilter }
      },
      include: {
        device: true,
        exhibition: true,
        zone: true
      },
      orderBy: { measuredAt: "asc" },
      take: REPORT_MAX_SOURCE_ROWS + 1
    });
    if (measurements.length > REPORT_MAX_SOURCE_ROWS) {
      throw new BadRequestException(`Report query exceeds ${REPORT_MAX_SOURCE_ROWS} source rows`);
    }

    const rows = measurements.map((item) => ({
      measuredAt: item.measuredAt,
      date: item.measuredAt.toISOString().slice(0, 10),
      time: item.measuredAt.toISOString().slice(11, 19),
      deviceId: item.deviceId,
      exhibition: item.exhibition?.name ?? null,
      zone: item.zone?.name ?? null,
      point: item.device.displayName,
      deviceName: item.device.deviceName,
      displayName: item.device.displayName,
      dehumidifySetpoint: item.dehumidifySetpoint,
      temperatureC: item.temperatureC,
      humidityPercent: item.humidityPercent,
      source: item.source,
      dataProfile: item.dataProfile,
      qualityFlags: item.qualityFlags
    }));

    if (query.interval === "raw") {
      return rows;
    }
    return this.aggregateRows(rows, query.interval);
  }

  async stats(rawQuery: unknown, user?: RequestUser) {
    const query = this.parseReportQuery(rawQuery);
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    return this.prisma.measurement.findMany({
      where: {
        dataProfile,
        measuredAt: { gte: query.start, lte: query.end },
        exhibitionId: scopedIdFilter(user, "exhibitionId", query.exhibitionId),
        zoneId: scopedIdFilter(user, "zoneId", query.zoneId),
        deviceId: this.deviceIdFilter(query.deviceId, query.deviceIds)
      },
      select: {
        temperatureC: true,
        humidityPercent: true,
        source: true
      }
    });
  }

  private thresholdAlertStillCurrent(
    alert: { metadata: Prisma.JsonValue },
    measurement: { temperatureC: number; humidityPercent: number }
  ): boolean {
    const metadata = this.jsonObject(alert.metadata);
    const metric = metadata.thresholdMetric;
    const direction = metadata.thresholdDirection;
    const limit = Number(metadata.thresholdLimit);
    if ((metric !== "temperature" && metric !== "humidity") || (direction !== "above" && direction !== "below") || !Number.isFinite(limit)) {
      return false;
    }
    const measuredValue = metric === "temperature" ? measurement.temperatureC : measurement.humidityPercent;
    return direction === "above" ? measuredValue > limit : measuredValue < limit;
  }

  private resolveThresholdAlert(alertId: string, resolvedAt: Date) {
    return this.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "resolved",
        resolvedAt,
        events: {
          create: {
            eventType: "resolved",
            message: "Latest overview measurement returned to threshold range"
          }
        }
      }
    });
  }

  private jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private deviceIdFilter(deviceId?: string, deviceIds?: string[]): string | { in: string[] } | undefined {
    const ids = Array.from(new Set([...(deviceIds ?? []), ...(deviceId ? [deviceId] : [])].filter(Boolean)));
    if (!ids.length) {
      return undefined;
    }
    return ids.length === 1 ? ids[0]! : { in: ids };
  }

  private normalizeDeviceIds(deviceId?: string, deviceIds?: string | string[]) {
    const values = [
      deviceId,
      ...(Array.isArray(deviceIds)
        ? deviceIds
        : typeof deviceIds === "string"
          ? deviceIds.split(",")
          : []),
    ];
    return Array.from(
      new Set(
        values
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
  }

  private parseReportQuery(rawQuery: unknown): ReportQuery {
    if (!this.hasReportDeviceSelection(rawQuery)) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: [{ path: ["deviceIds"], message: "NMTH_REPORT_REQUIRES_DEVICE_SELECTION" }]
      });
    }
    const result = reportQuerySchema.safeParse(rawQuery);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues
      });
    }
    return result.data;
  }

  private hasReportDeviceSelection(rawQuery: unknown): boolean {
    const query = rawQuery && typeof rawQuery === "object" ? (rawQuery as Record<string, unknown>) : {};
    const deviceId = typeof query.deviceId === "string" ? query.deviceId.trim() : "";
    const rawDeviceIds = query.deviceIds;
    const deviceIds = (Array.isArray(rawDeviceIds) ? rawDeviceIds : rawDeviceIds === undefined ? [] : [rawDeviceIds])
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    return Boolean(deviceId || deviceIds.length);
  }

  private aggregateRows(rows: ReportRow[], interval: SamplingInterval): ReportRow[] {
    const bucketMs = this.intervalMs(interval);
    const buckets = new Map<string, ReportRow[]>();
    for (const row of rows) {
      const bucket = Math.floor(row.measuredAt.getTime() / bucketMs) * bucketMs;
      const key = `${row.deviceId}:${bucket}:${row.source}`;
      const existing = buckets.get(key) ?? [];
      existing.push(row);
      buckets.set(key, existing);
    }

    return Array.from(buckets.values()).map((items) => {
      const first = items[0]!;
      const temperature = summarizeNumbers(items.map((item) => item.temperatureC));
      const humidity = summarizeNumbers(items.map((item) => item.humidityPercent));
      const setpoints = items.map((item) => item.dehumidifySetpoint).filter((value): value is number => value !== null);
      const bucketAt = new Date(Math.floor(first.measuredAt.getTime() / bucketMs) * bucketMs);
      return {
        ...first,
        measuredAt: bucketAt,
        date: bucketAt.toISOString().slice(0, 10),
        time: bucketAt.toISOString().slice(11, 19),
        dehumidifySetpoint: setpoints.length ? summarizeNumbers(setpoints).average : null,
        temperatureC: temperature.average ?? first.temperatureC,
        humidityPercent: humidity.average ?? first.humidityPercent,
        qualityFlags: ["aggregated", `count:${items.length}`]
      };
    });
  }

  private intervalMs(interval: SamplingInterval): number {
    const map: Record<SamplingInterval, number> = {
      raw: 60_000,
      "5m": 5 * 60_000,
      "10m": 10 * 60_000,
      "30m": 30 * 60_000,
      "1h": 60 * 60_000,
      "1d": 24 * 60 * 60_000
    };
    return map[interval];
  }
}
