import { Injectable } from "@nestjs/common";
import { DEFAULT_PARSE_VERSION } from "@nmth/shared";
import { assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CompensationService {
  constructor(private readonly prisma: PrismaService) {}

  async detectGaps(input: { deviceId?: string; start: Date; end: Date; expectedIntervalSeconds?: number }, user?: RequestUser) {
    const expected = input.expectedIntervalSeconds ?? 60;
    const dataProfile = await resolveScopedDataProfile(this.prisma, user);
    const devices = await this.prisma.device.findMany({
      where: { id: input.deviceId, dataProfile, exhibitionId: scopedIdFilter(user, "exhibitionId"), zoneId: scopedIdFilter(user, "zoneId") },
      include: {
        measurements: {
          where: { dataProfile, measuredAt: { gte: input.start, lte: input.end }, source: { in: ["real", "imported"] } },
          orderBy: { measuredAt: "asc" }
        }
      }
    });
    return devices.flatMap((device) => {
      const gaps = [];
      for (let index = 1; index < device.measurements.length; index += 1) {
        const previous = device.measurements[index - 1]!;
        const current = device.measurements[index]!;
        const deltaSeconds = (current.measuredAt.getTime() - previous.measuredAt.getTime()) / 1000;
        if (deltaSeconds > expected * 1.5) {
          gaps.push({
            deviceId: device.id,
            deviceName: device.deviceName,
            start: previous.measuredAt,
            end: current.measuredAt,
            missingCount: Math.max(0, Math.round(deltaSeconds / expected) - 1),
            before: previous,
            after: current
          });
        }
      }
      return gaps;
    });
  }

  async generate(input: {
    deviceId: string;
    start: Date;
    end: Date;
    method: "linear_interpolation" | "previous_value" | "manual";
    reason: string;
    operatorUser?: RequestUser;
    manualTemperatureC?: number;
    manualHumidityPercent?: number;
  }) {
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: input.deviceId } });
    assertDataProfileAllowed(input.operatorUser, device.dataProfile);
    assertScopedResourceIds(input.operatorUser, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    const dataProfile = device.dataProfile;
    const [previous, next] = await Promise.all([
      this.prisma.measurement.findFirst({
        where: { dataProfile, deviceId: input.deviceId, measuredAt: { lt: input.start }, source: { in: ["real", "imported"] } },
        orderBy: { measuredAt: "desc" }
      }),
      this.prisma.measurement.findFirst({
        where: { dataProfile, deviceId: input.deviceId, measuredAt: { gt: input.end }, source: { in: ["real", "imported"] } },
        orderBy: { measuredAt: "asc" }
      })
    ]);
    if (!previous && input.method !== "manual") {
      throw new Error("Previous measurement is required for this compensation method");
    }

    const adjustment = await this.prisma.measurementAdjustment.create({
      data: {
        type: "compensation",
        method: input.method,
        reason: input.reason,
        operatorUserId: input.operatorUser?.id,
        sourceRange: { start: input.start, end: input.end, previousId: previous?.id, nextId: next?.id },
        parameters: {
          manualTemperatureC: input.manualTemperatureC,
          manualHumidityPercent: input.manualHumidityPercent
        }
      }
    });

    const points = [];
    for (let at = input.start.getTime(); at <= input.end.getTime(); at += 60_000) {
      const measuredAt = new Date(at);
      const ratio =
        previous && next
          ? (measuredAt.getTime() - previous.measuredAt.getTime()) / (next.measuredAt.getTime() - previous.measuredAt.getTime())
          : 0;
      const temperatureC =
        input.method === "manual"
          ? input.manualTemperatureC ?? previous?.temperatureC ?? 0
          : input.method === "linear_interpolation" && previous && next
            ? previous.temperatureC + (next.temperatureC - previous.temperatureC) * ratio
            : previous?.temperatureC ?? 0;
      const humidityPercent =
        input.method === "manual"
          ? input.manualHumidityPercent ?? previous?.humidityPercent ?? 0
          : input.method === "linear_interpolation" && previous && next
            ? previous.humidityPercent + (next.humidityPercent - previous.humidityPercent) * ratio
            : previous?.humidityPercent ?? 0;
      points.push({
        measuredAt,
        dataProfile,
        deviceId: device.id,
        exhibitionId: device.exhibitionId,
        zoneId: device.zoneId,
        source: "compensated",
        temperatureC,
        humidityPercent,
        dehumidifySetpoint: previous?.dehumidifySetpoint ?? null,
        qualityFlags: ["compensated", input.method],
        parseVersion: DEFAULT_PARSE_VERSION,
        operatorUserId: input.operatorUser?.id,
        adjustmentId: adjustment.id,
        reason: input.reason,
        method: input.method,
        metadata: { previousId: previous?.id, nextId: next?.id }
      });
    }

    const created = await this.prisma.measurement.createMany({
      data: points,
      skipDuplicates: true
    });
    await writeAuditLog(this.prisma, {
      userId: input.operatorUser?.id,
      action: "measurement.compensate",
      entityType: "measurement_adjustment",
      entityId: adjustment.id,
      riskLevel: "high",
      reason: input.reason,
      after: { created: created.count, method: input.method, deviceId: input.deviceId, start: input.start, end: input.end }
    });
    return { adjustmentId: adjustment.id, created: created.count };
  }
}
