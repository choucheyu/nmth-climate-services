import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { getActiveDataProfile, normalizeDataProfile } from "../common/data-profile";

const DEFAULT_ALERT_PAGE = 1;
const DEFAULT_ALERT_PAGE_SIZE = 25;
const MAX_ALERT_PAGE_SIZE = 100;
const DEFAULT_OFFLINE_CUTOFF_MINUTES = 3;
const MAX_OFFLINE_CUTOFF_MINUTES = 7 * 24 * 60;
const ACTIVE_ALERT_STATUSES = ["active", "acknowledged"] as const;
const THRESHOLD_ALERT_TYPES = ["humidity_threshold", "temperature_threshold"] as const;
const SUSTAINED_SAMPLE_JITTER_MS = 30_000;
const MAX_CONTIGUOUS_SAMPLE_GAP_MS = 60_000 + SUSTAINED_SAMPLE_JITTER_MS;

interface MeasurementForEvaluation {
  id: string;
  measuredAt: Date;
  deviceId: string;
  exhibitionId: string | null;
  zoneId: string | null;
  temperatureC: number;
  humidityPercent: number;
  source: string;
  dataProfile: string;
}

type ThresholdMetric = "temperature" | "humidity";
type ThresholdDirection = "above" | "below";
type ThresholdAlertType = (typeof THRESHOLD_ALERT_TYPES)[number];
type ThresholdAssignmentWithProfile = Prisma.ThresholdAssignmentGetPayload<{ include: { profile: true } }>;

interface ThresholdBreach {
  type: "temperature_threshold" | "humidity_threshold";
  metric: ThresholdMetric;
  direction: ThresholdDirection;
  limit: number;
  measuredValue: number;
  startedAt: Date;
  exceededMinutes: number;
}

type ThresholdSample = Pick<MeasurementForEvaluation, "id" | "measuredAt" | "temperatureC" | "humidityPercent">;

export interface AlertRepairSummary {
  dataProfile: string;
  dryRun: boolean;
  scannedDeviceCount: number;
  thresholdAssignedDeviceCount: number;
  violatingDeviceCount: number;
  alertsCreated: number;
  alertsRefreshed: number;
  alertsSkipped: number;
  alertsWouldCreate: number;
  alertsWouldRefresh: number;
  skipReasons: Record<string, number>;
  errorCount: number;
  errors: Array<{ deviceId: string; deviceName: string; reason: string }>;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    status?: string | null;
    level?: string | null;
    type?: string | null;
    deviceId?: string | null;
    exhibitionId?: string | null;
    zoneId?: string | null;
    dataProfile?: string | null;
    page?: number | string | null;
    pageSize?: number | string | null;
  }, user?: RequestUser) {
    const page = this.normalizePositiveInteger(query.page, DEFAULT_ALERT_PAGE, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.normalizePositiveInteger(query.pageSize, DEFAULT_ALERT_PAGE_SIZE, 1, MAX_ALERT_PAGE_SIZE);
    const requestedProfile = this.normalizeOptionalFilter(query.dataProfile);
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, requestedProfile);
    const where: Prisma.AlertWhereInput = { dataProfile };
    const status = this.normalizeOptionalFilter(query.status);
    const level = this.normalizeOptionalFilter(query.level);
    const type = this.normalizeOptionalFilter(query.type);
    const deviceId = this.normalizeOptionalFilter(query.deviceId);
    const exhibitionId = this.normalizeOptionalFilter(query.exhibitionId);
    const zoneId = this.normalizeOptionalFilter(query.zoneId);
    if (status) where.status = status;
    if (level) where.level = level;
    if (type) where.type = type;
    if (deviceId) where.deviceId = deviceId;
    where.exhibitionId = scopedIdFilter(user, "exhibitionId", exhibitionId);
    where.zoneId = scopedIdFilter(user, "zoneId", zoneId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        include: {
          device: true,
          exhibition: true,
          zone: true,
          acknowledgements: { orderBy: { createdAt: "desc" }, take: 3 }
        },
        orderBy: { triggeredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.alert.count({ where })
    ]);
    const now = new Date();
    const silences = await this.prisma.alertSilenceWindow.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { endsAt: "asc" }
    });
    const enriched = items.map((alert) => ({
      ...alert,
      activeSilences: silences.filter((silence) => this.silenceMatchesAlert(silence, alert))
    }));
    return { items: enriched, total, page, pageSize, dataProfile };
  }

  async acknowledge(input: { alertId: string; user?: RequestUser; note?: string }) {
    const before = await this.prisma.alert.findUniqueOrThrow({ where: { id: input.alertId } });
    assertDataProfileAllowed(input.user, before.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: before.exhibitionId, zoneId: before.zoneId });
    const alert = await this.prisma.alert.update({
      where: { id: input.alertId },
      data: {
        status: "acknowledged",
        acknowledgements: {
          create: {
            userId: input.user?.id,
            note: input.note
          }
        },
        events: {
          create: {
            eventType: "acknowledged",
            message: input.note
          }
        }
      }
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "alert.acknowledge",
      entityType: "alert",
      entityId: alert.id,
      after: { status: "acknowledged", note: input.note }
    });
    return alert;
  }

  async silenceAlert(input: { alertId: string; user?: RequestUser; reason: string; durationMinutes: number }) {
    const alert = await this.prisma.alert.findUniqueOrThrow({ where: { id: input.alertId } });
    assertDataProfileAllowed(input.user, alert.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: alert.exhibitionId, zoneId: alert.zoneId });
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    const silence = await this.prisma.alertSilenceWindow.create({
      data: {
        scope: "alert",
        scopeId: alert.id,
        startsAt,
        endsAt,
        reason: input.reason,
        createdByUserId: input.user?.id
      }
    });
    await this.prisma.alertEvent.create({
      data: {
        alertId: alert.id,
        eventType: "silenced",
        message: input.reason,
        payload: { silenceWindowId: silence.id, startsAt, endsAt }
      }
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "alert.silence",
      entityType: "alert",
      entityId: alert.id,
      after: { silenceWindowId: silence.id, startsAt, endsAt, reason: input.reason }
    });
    return silence;
  }

  async evaluateMeasurement(measurement: MeasurementForEvaluation): Promise<void> {
    if (measurement.source !== "real" && measurement.source !== "imported") {
      return;
    }

    await this.resolveOfflineAlertForDevice(measurement.deviceId, measurement.dataProfile, measurement.measuredAt);

    const assignment = await this.thresholdAssignmentFor(measurement);
    if (!assignment) {
      return;
    }

    const profile = assignment.profile;
    const currentBreaches = this.currentBreaches(measurement, profile);
    if (!currentBreaches.length) {
      await this.resolveRecoverableAlerts(measurement.deviceId, measurement.dataProfile, measurement.measuredAt);
      return;
    }

    const currentTypes = new Set(currentBreaches.map((breach) => breach.type));
    await this.resolveRecoverableAlerts(
      measurement.deviceId,
      measurement.dataProfile,
      measurement.measuredAt,
      THRESHOLD_ALERT_TYPES.filter((type) => !currentTypes.has(type))
    );

    const breaches = await this.sustainedBreaches(measurement, profile, currentBreaches);
    if (!breaches.length) {
      return;
    }

    for (const breach of breaches) {
      const existing = await this.prisma.alert.findFirst({
        where: {
          dataProfile: measurement.dataProfile,
          deviceId: measurement.deviceId,
          type: breach.type,
          status: { in: [...ACTIVE_ALERT_STATUSES] }
        }
      });
      const title = breach.type === "humidity_threshold" ? "Humidity warning threshold exceeded" : "Temperature warning threshold exceeded";
      const message = `${title}: ${breach.measuredValue.toFixed(1)} ${breach.metric === "temperature" ? "C" : "%RH"} is ${breach.direction} ${breach.limit}.`;
      const metadata = {
        measurementId: measurement.id,
        profileId: profile.id,
        thresholdMetric: breach.metric,
        thresholdDirection: breach.direction,
        thresholdLimit: breach.limit,
        measuredValue: breach.measuredValue,
        exceededSince: breach.startedAt.toISOString(),
        exceededMinutes: breach.exceededMinutes,
        triggerDurationMinutes: profile.triggerDurationMinutes,
        recoveryDurationMinutes: profile.recoveryDurationMinutes,
        repeatIntervalMinutes: profile.repeatIntervalMinutes,
        maxNotifications: profile.maxNotifications,
        unresolvedReminderMinutes: profile.unresolvedReminderMinutes
      };

      if (existing) {
        await this.refreshExistingThresholdAlert(existing, message, metadata, measurement.measuredAt);
        continue;
      }

      if (await this.isSilenced({ deviceId: measurement.deviceId, zoneId: measurement.zoneId, exhibitionId: measurement.exhibitionId })) {
        continue;
      }

      const nextReminderAt = new Date(measurement.measuredAt.getTime() + profile.repeatIntervalMinutes * 60_000);
      await this.prisma.alert.create({
        data: {
          dataProfile: measurement.dataProfile,
          exhibitionId: measurement.exhibitionId,
          zoneId: measurement.zoneId,
          deviceId: measurement.deviceId,
          type: breach.type,
          level: "warning",
          status: "active",
          title,
          message,
          triggeredAt: measurement.measuredAt,
          lastNotifiedAt: measurement.measuredAt,
          metadata: {
            ...metadata,
            notificationCount: 1,
            nextReminderAt: nextReminderAt.toISOString()
          },
          events: {
            create: {
              eventType: "triggered",
              level: "warning",
              message,
              payload: { ...metadata, measuredAt: measurement.measuredAt }
            }
          }
        }
      });
    }
  }

  async evaluateLatestMeasurementForDevice(deviceId: string, requestedProfile: string): Promise<boolean> {
    const dataProfile = normalizeDataProfile(requestedProfile);
    const measurement = await this.prisma.measurement.findFirst({
      where: {
        deviceId,
        dataProfile,
        source: { in: ["real", "imported"] }
      },
      orderBy: { measuredAt: "desc" }
    });
    if (!measurement) {
      return false;
    }
    await this.evaluateMeasurement({
      id: measurement.id,
      measuredAt: measurement.measuredAt,
      deviceId: measurement.deviceId,
      exhibitionId: measurement.exhibitionId,
      zoneId: measurement.zoneId,
      temperatureC: measurement.temperatureC,
      humidityPercent: measurement.humidityPercent,
      source: measurement.source,
      dataProfile: measurement.dataProfile
    });
    return true;
  }

  private async thresholdAssignmentFor(measurement: MeasurementForEvaluation) {
    return this.thresholdAssignmentForContext({
      deviceId: measurement.deviceId,
      zoneId: measurement.zoneId,
      exhibitionId: measurement.exhibitionId,
      dataProfile: measurement.dataProfile,
      at: measurement.measuredAt
    });
  }

  private async thresholdAssignmentForContext(input: {
    deviceId: string;
    zoneId: string | null;
    exhibitionId: string | null;
    dataProfile: string;
    at: Date;
  }): Promise<ThresholdAssignmentWithProfile | null> {
    const activeWindow = this.assignmentWindowWhere(input.at);
    const deviceAssignment = await this.prisma.thresholdAssignment.findFirst({
      where: {
        deviceId: input.deviceId,
        device: { is: { dataProfile: input.dataProfile } },
        ...activeWindow
      },
      include: { profile: true },
      orderBy: { priority: "asc" }
    });
    if (deviceAssignment) return deviceAssignment;
    if (input.zoneId) {
      const zoneAssignment = await this.prisma.thresholdAssignment.findFirst({
        where: {
          zoneId: input.zoneId,
          zone: { is: { exhibition: { is: { dataProfile: input.dataProfile } } } },
          ...activeWindow
        },
        include: { profile: true },
        orderBy: { priority: "asc" }
      });
      if (zoneAssignment) return zoneAssignment;
    }
    if (input.exhibitionId) {
      return this.prisma.thresholdAssignment.findFirst({
        where: {
          exhibitionId: input.exhibitionId,
          exhibition: { is: { dataProfile: input.dataProfile } },
          ...activeWindow
        },
        include: { profile: true },
        orderBy: { priority: "asc" }
      });
    }
    return null;
  }

  private async sustainedBreaches(
    measurement: MeasurementForEvaluation,
    profile: {
      warningTemperatureMin: number | null;
      warningTemperatureMax: number | null;
      warningHumidityMin: number | null;
      warningHumidityMax: number | null;
      triggerDurationMinutes: number;
    },
    currentBreaches = this.currentBreaches(measurement, profile)
  ): Promise<ThresholdBreach[]> {
    if (!currentBreaches.length) {
      return [];
    }
    if (profile.triggerDurationMinutes <= 0) {
      return currentBreaches.map((breach) => ({ ...breach, startedAt: measurement.measuredAt, exceededMinutes: 0 }));
    }
    const triggerDurationMs = profile.triggerDurationMinutes * 60_000;
    const start = new Date(measurement.measuredAt.getTime() - triggerDurationMs - MAX_CONTIGUOUS_SAMPLE_GAP_MS);
    const storedSamples = await this.prisma.measurement.findMany({
      where: {
        deviceId: measurement.deviceId,
        dataProfile: measurement.dataProfile,
        measuredAt: { gte: start, lte: measurement.measuredAt },
        source: { in: ["real", "imported"] }
      },
      orderBy: { measuredAt: "desc" }
    });
    const samples = this.mergeLatestSample(measurement, storedSamples);
    return currentBreaches
      .map((breach) => {
        const segment = this.latestViolatingSegment(samples, breach);
        if (!segment.length) {
          return null;
        }
        const first = segment[segment.length - 1]!;
        const exceededMs = measurement.measuredAt.getTime() - first.measuredAt.getTime();
        if (exceededMs < triggerDurationMs) {
          return null;
        }
        const exceededMinutes = Math.floor(exceededMs / 60_000);
        return { ...breach, startedAt: first.measuredAt, exceededMinutes };
      })
      .filter((value): value is ThresholdBreach => Boolean(value));
  }

  async detectOffline(cutoffMinutes = DEFAULT_OFFLINE_CUTOFF_MINUTES, requestedProfile?: string, user?: RequestUser): Promise<number> {
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, requestedProfile);
    const normalizedCutoffMinutes = this.normalizePositiveInteger(cutoffMinutes, DEFAULT_OFFLINE_CUTOFF_MINUTES, 1, MAX_OFFLINE_CUTOFF_MINUTES);
    const now = new Date();
    const cutoff = new Date(now.getTime() - normalizedCutoffMinutes * 60_000);
    await this.resolveRecoveredOfflineAlerts(dataProfile, cutoff, now, user);
    const devices = await this.prisma.device.findMany({
      where: {
        dataProfile,
        exhibitionId: scopedIdFilter(user, "exhibitionId"),
        zoneId: scopedIdFilter(user, "zoneId"),
        enabled: true,
        archivedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }]
      }
    });
    for (const device of devices) {
      if (await this.isSilenced({ deviceId: device.id, zoneId: device.zoneId, exhibitionId: device.exhibitionId })) {
        continue;
      }
      const existing = await this.prisma.alert.findFirst({
        where: { dataProfile, deviceId: device.id, type: "device_offline", status: { in: [...ACTIVE_ALERT_STATUSES] } }
      });
      if (!existing) {
        await this.prisma.alert.create({
          data: {
            dataProfile,
            exhibitionId: device.exhibitionId,
            zoneId: device.zoneId,
            deviceId: device.id,
            type: "device_offline",
            level: "warning",
            status: "active",
            title: "Device offline",
            message: `${device.displayName} has no recent measurement`,
            triggeredAt: now,
            metadata: { cutoffMinutes: normalizedCutoffMinutes, lastSeenAt: device.lastSeenAt }
          }
        });
      }
    }
    return devices.length;
  }

  async repairThresholdAlerts(input: { dataProfile?: string; write?: boolean } = {}): Promise<AlertRepairSummary> {
    const requestedProfile = this.normalizeOptionalFilter(input.dataProfile);
    const dataProfile = requestedProfile ? normalizeDataProfile(requestedProfile) : await getActiveDataProfile(this.prisma);
    const dryRun = input.write !== true;
    const summary: AlertRepairSummary = {
      dataProfile,
      dryRun,
      scannedDeviceCount: 0,
      thresholdAssignedDeviceCount: 0,
      violatingDeviceCount: 0,
      alertsCreated: 0,
      alertsRefreshed: 0,
      alertsSkipped: 0,
      alertsWouldCreate: 0,
      alertsWouldRefresh: 0,
      skipReasons: {},
      errorCount: 0,
      errors: []
    };
    const devices = await this.prisma.device.findMany({
      where: {
        dataProfile,
        enabled: true,
        archivedAt: null
      },
      include: {
        measurements: {
          where: { dataProfile, source: { in: ["real", "imported"] } },
          orderBy: { measuredAt: "desc" },
          take: 1
        }
      },
      orderBy: { deviceName: "asc" }
    });
    summary.scannedDeviceCount = devices.length;

    for (const device of devices) {
      try {
        const assignment = await this.thresholdAssignmentForContext({
          deviceId: device.id,
          zoneId: device.zoneId,
          exhibitionId: device.exhibitionId,
          dataProfile,
          at: device.measurements[0]?.measuredAt ?? new Date()
        });
        if (!assignment) {
          this.recordRepairSkip(summary, "no_threshold_assignment");
          continue;
        }
        summary.thresholdAssignedDeviceCount += 1;

        const latest = device.measurements[0];
        if (!latest) {
          this.recordRepairSkip(summary, "no_latest_measurement");
          continue;
        }

        const measurement: MeasurementForEvaluation = {
          id: latest.id,
          measuredAt: latest.measuredAt,
          deviceId: latest.deviceId,
          exhibitionId: latest.exhibitionId,
          zoneId: latest.zoneId,
          temperatureC: latest.temperatureC,
          humidityPercent: latest.humidityPercent,
          source: latest.source,
          dataProfile: latest.dataProfile
        };
        const currentBreaches = this.currentBreaches(measurement, assignment.profile);
        if (!currentBreaches.length) {
          this.recordRepairSkip(summary, "not_violating");
          continue;
        }
        const breaches = await this.sustainedBreaches(measurement, assignment.profile, currentBreaches);
        if (!breaches.length) {
          this.recordRepairSkip(summary, "duration_not_met");
          continue;
        }
        summary.violatingDeviceCount += 1;

        const breachedTypes = [...new Set(breaches.map((breach) => breach.type))] as ThresholdAlertType[];
        const existingAlerts = await this.prisma.alert.findMany({
          where: {
            dataProfile,
            deviceId: device.id,
            type: { in: breachedTypes },
            status: { in: [...ACTIVE_ALERT_STATUSES] }
          },
          select: { id: true, type: true }
        });
        const existingTypes = new Set(existingAlerts.map((alert) => alert.type));
        const missingTypes = breachedTypes.filter((type) => !existingTypes.has(type));
        const existingCount = existingAlerts.length;

        if (dryRun) {
          summary.alertsWouldCreate += missingTypes.length;
          summary.alertsWouldRefresh += existingCount;
          summary.alertsSkipped += missingTypes.length + existingCount;
          if (missingTypes.length) this.recordRepairSkip(summary, "dry_run_would_create", missingTypes.length);
          if (existingCount) this.recordRepairSkip(summary, "existing_active_or_acknowledged", existingCount);
          continue;
        }

        const silenced = missingTypes.length
          ? await this.isSilenced({ deviceId: device.id, zoneId: device.zoneId, exhibitionId: device.exhibitionId })
          : false;
        if (silenced) {
          summary.alertsSkipped += missingTypes.length;
          this.recordRepairSkip(summary, "silenced", missingTypes.length);
          if (existingCount) {
            await this.evaluateMeasurement(measurement);
            summary.alertsRefreshed += existingCount;
          }
          continue;
        }

        await this.evaluateMeasurement(measurement);
        summary.alertsCreated += missingTypes.length;
        summary.alertsRefreshed += existingCount;
      } catch (error) {
        summary.errorCount += 1;
        summary.errors.push({
          deviceId: device.id,
          deviceName: device.deviceName,
          reason: error instanceof Error ? error.message : String(error)
        });
        this.recordRepairSkip(summary, "error");
      }
    }

    return summary;
  }

  private currentBreaches(
    measurement: MeasurementForEvaluation,
    profile: {
      warningTemperatureMin: number | null;
      warningTemperatureMax: number | null;
      warningHumidityMin: number | null;
      warningHumidityMax: number | null;
    }
  ): Array<Omit<ThresholdBreach, "startedAt" | "exceededMinutes">> {
    const breaches: Array<Omit<ThresholdBreach, "startedAt" | "exceededMinutes">> = [];
    if (profile.warningTemperatureMax !== null && measurement.temperatureC > profile.warningTemperatureMax) {
      breaches.push({
        type: "temperature_threshold",
        metric: "temperature",
        direction: "above",
        limit: profile.warningTemperatureMax,
        measuredValue: measurement.temperatureC
      });
    }
    if (profile.warningTemperatureMin !== null && measurement.temperatureC < profile.warningTemperatureMin) {
      breaches.push({
        type: "temperature_threshold",
        metric: "temperature",
        direction: "below",
        limit: profile.warningTemperatureMin,
        measuredValue: measurement.temperatureC
      });
    }
    if (profile.warningHumidityMax !== null && measurement.humidityPercent > profile.warningHumidityMax) {
      breaches.push({
        type: "humidity_threshold",
        metric: "humidity",
        direction: "above",
        limit: profile.warningHumidityMax,
        measuredValue: measurement.humidityPercent
      });
    }
    if (profile.warningHumidityMin !== null && measurement.humidityPercent < profile.warningHumidityMin) {
      breaches.push({
        type: "humidity_threshold",
        metric: "humidity",
        direction: "below",
        limit: profile.warningHumidityMin,
        measuredValue: measurement.humidityPercent
      });
    }
    return breaches;
  }

  private violatesBound(value: number, direction: ThresholdDirection, limit: number) {
    return direction === "above" ? value > limit : value < limit;
  }

  private assignmentWindowWhere(at: Date): Prisma.ThresholdAssignmentWhereInput {
    return {
      AND: [
        { OR: [{ activeFrom: null }, { activeFrom: { lte: at } }] },
        { OR: [{ activeUntil: null }, { activeUntil: { gt: at } }] }
      ]
    };
  }

  private mergeLatestSample(measurement: MeasurementForEvaluation, storedSamples: ThresholdSample[]): ThresholdSample[] {
    const byId = new Map<string, ThresholdSample>();
    byId.set(measurement.id, measurement);
    for (const sample of storedSamples) {
      byId.set(sample.id, sample);
    }
    return [...byId.values()].sort((left, right) => right.measuredAt.getTime() - left.measuredAt.getTime());
  }

  private latestViolatingSegment(
    samples: ThresholdSample[],
    breach: Omit<ThresholdBreach, "startedAt" | "exceededMinutes">
  ): ThresholdSample[] {
    const segment: ThresholdSample[] = [];
    let newerSample: ThresholdSample | null = null;
    for (const sample of samples) {
      const value = breach.metric === "temperature" ? sample.temperatureC : sample.humidityPercent;
      if (!this.violatesBound(value, breach.direction, breach.limit)) {
        break;
      }
      if (newerSample) {
        const gapMs = newerSample.measuredAt.getTime() - sample.measuredAt.getTime();
        if (gapMs > MAX_CONTIGUOUS_SAMPLE_GAP_MS) {
          break;
        }
      }
      segment.push(sample);
      newerSample = sample;
    }
    return segment;
  }

  private normalizeOptionalFilter(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.toLowerCase() === "all") {
      return undefined;
    }
    return normalized;
  }

  private normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  private recordRepairSkip(summary: AlertRepairSummary, reason: string, count = 1) {
    summary.skipReasons[reason] = (summary.skipReasons[reason] ?? 0) + count;
  }

  private async refreshExistingThresholdAlert(
    alert: { id: string; status: string; triggeredAt: Date; metadata: Prisma.JsonValue },
    message: string,
    metadata: Record<string, unknown>,
    measuredAt: Date
  ) {
    const existingMetadata = this.jsonObject(alert.metadata);
    const notificationCount = Number(existingMetadata.notificationCount ?? 0);
    const maxNotifications = Number(metadata.maxNotifications ?? 3);
    const repeatIntervalMinutes = Number(metadata.repeatIntervalMinutes ?? 60);
    const unresolvedReminderMinutes = Number(metadata.unresolvedReminderMinutes ?? repeatIntervalMinutes);
    const nextReminderAtValue = existingMetadata.nextReminderAt ? new Date(String(existingMetadata.nextReminderAt)) : null;
    const unresolvedReminderAt = new Date(alert.triggeredAt.getTime() + unresolvedReminderMinutes * 60_000);
    const reminderDue =
      alert.status === "active" &&
      notificationCount < maxNotifications &&
      ((nextReminderAtValue && measuredAt >= nextReminderAtValue) || measuredAt >= unresolvedReminderAt);
    const nextReminderAt = reminderDue
      ? new Date(measuredAt.getTime() + repeatIntervalMinutes * 60_000)
      : nextReminderAtValue ?? new Date(measuredAt.getTime() + repeatIntervalMinutes * 60_000);

    await this.prisma.alert.update({
      where: { id: alert.id },
      data: {
        message,
        lastNotifiedAt: reminderDue ? measuredAt : undefined,
        metadata: {
          ...existingMetadata,
          ...metadata,
          notificationCount: reminderDue ? notificationCount + 1 : notificationCount,
          nextReminderAt: nextReminderAt.toISOString()
        },
        events: {
          create: {
            eventType: reminderDue ? "reminder_due" : "sample_exceeded",
            level: "warning",
            message,
            payload: { ...metadata, measuredAt, notificationCount: reminderDue ? notificationCount + 1 : notificationCount }
          }
        }
      }
    });
  }

  private async resolveRecoverableAlerts(
    deviceId: string,
    dataProfile: string,
    resolvedAt: Date,
    types: readonly ThresholdAlertType[] = THRESHOLD_ALERT_TYPES
  ): Promise<void> {
    if (!types.length) return;
    const alerts = await this.prisma.alert.findMany({
      where: {
        dataProfile,
        deviceId,
        type: { in: [...types] },
        status: { in: [...ACTIVE_ALERT_STATUSES] }
      }
    });
    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: "resolved",
          resolvedAt,
          events: {
            create: { eventType: "resolved", message: "Measurement returned to threshold range" }
          }
        }
      });
    }
  }

  private async resolveOfflineAlertForDevice(deviceId: string, dataProfile: string, resolvedAt: Date): Promise<void> {
    const alerts = await this.prisma.alert.findMany({
      where: {
        dataProfile,
        deviceId,
        type: "device_offline",
        triggeredAt: { lte: resolvedAt },
        status: { in: [...ACTIVE_ALERT_STATUSES] }
      }
    });
    for (const alert of alerts) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: "resolved",
          resolvedAt,
          events: {
            create: { eventType: "resolved", message: "Device returned online" }
          }
        }
      });
    }
  }

  private async resolveRecoveredOfflineAlerts(dataProfile: string, cutoff: Date, resolvedAt: Date, user?: RequestUser): Promise<void> {
    const alerts = await this.prisma.alert.findMany({
      where: {
        dataProfile,
        exhibitionId: scopedIdFilter(user, "exhibitionId"),
        zoneId: scopedIdFilter(user, "zoneId"),
        type: "device_offline",
        status: { in: [...ACTIVE_ALERT_STATUSES] }
      },
      include: { device: true }
    });
    for (const alert of alerts) {
      if (alert.device?.lastSeenAt && alert.device.lastSeenAt >= cutoff) {
        await this.prisma.alert.update({
          where: { id: alert.id },
          data: {
            status: "resolved",
            resolvedAt,
            events: {
              create: { eventType: "resolved", message: "Device returned online" }
            }
          }
        });
      }
    }
  }

  private jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private async isSilenced(input: { alertId?: string; deviceId?: string | null; zoneId?: string | null; exhibitionId?: string | null }) {
    const now = new Date();
    const scopes: Prisma.AlertSilenceWindowWhereInput[] = [{ scope: "global", scopeId: null }];
    if (input.alertId) scopes.push({ scope: "alert", scopeId: input.alertId });
    if (input.deviceId) scopes.push({ scope: "device", scopeId: input.deviceId });
    if (input.zoneId) scopes.push({ scope: "zone", scopeId: input.zoneId });
    if (input.exhibitionId) scopes.push({ scope: "exhibition", scopeId: input.exhibitionId });
    const windows = await this.prisma.alertSilenceWindow.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: scopes
      }
    });
    return windows.length > 0;
  }

  private silenceMatchesAlert(silence: { scope: string; scopeId: string | null }, alert: { id: string; deviceId: string | null; zoneId: string | null; exhibitionId: string | null }) {
    if (silence.scope === "global") return true;
    if (silence.scope === "alert") return silence.scopeId === alert.id;
    if (silence.scope === "device") return silence.scopeId === alert.deviceId;
    if (silence.scope === "zone") return silence.scopeId === alert.zoneId;
    if (silence.scope === "exhibition") return silence.scopeId === alert.exhibitionId;
    return false;
  }
}
