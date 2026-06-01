import { Injectable } from "@nestjs/common";
import { DEFAULT_PARSE_VERSION } from "@nmth/shared";
import { assertDataProfileAllowed, assertScopedResourceIds } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SyntheticService {
  constructor(private readonly prisma: PrismaService) {}

  async generateTargetApproach(input: {
    deviceId: string;
    start: Date;
    end: Date;
    reason: string;
    operatorUser?: RequestUser;
    approachFactor?: number;
  }) {
    const factor = input.approachFactor ?? 0.65;
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: input.deviceId } });
    assertDataProfileAllowed(input.operatorUser, device.dataProfile);
    assertScopedResourceIds(input.operatorUser, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    const dataProfile = device.dataProfile;
    const sourceMeasurements = await this.prisma.measurement.findMany({
      where: {
        dataProfile,
        deviceId: input.deviceId,
        measuredAt: { gte: input.start, lte: input.end },
        source: { in: ["real", "imported"] },
        dehumidifySetpoint: { not: null }
      },
      orderBy: { measuredAt: "asc" }
    });
    const adjustment = await this.prisma.measurementAdjustment.create({
      data: {
        type: "derived",
        method: "humidity_moves_toward_dehumidify_setpoint",
        reason: input.reason,
        operatorUserId: input.operatorUser?.id,
        sourceRange: { start: input.start, end: input.end, sourceCount: sourceMeasurements.length },
        parameters: { approachFactor: factor }
      }
    });

    const created = await this.prisma.measurement.createMany({
      data: sourceMeasurements.map((measurement) => {
        const target = Number(measurement.dehumidifySetpoint);
        const syntheticHumidity = measurement.humidityPercent + (target - measurement.humidityPercent) * factor;
        return {
          measuredAt: measurement.measuredAt,
          dataProfile,
          deviceId: input.deviceId,
          exhibitionId: device.exhibitionId,
          zoneId: device.zoneId,
          source: "derived",
          temperatureC: measurement.temperatureC,
          humidityPercent: syntheticHumidity,
          dehumidifySetpoint: measurement.dehumidifySetpoint,
          qualityFlags: ["derived_target_approach", "not_device_measurement"],
          parseVersion: DEFAULT_PARSE_VERSION,
          operatorUserId: input.operatorUser?.id,
          adjustmentId: adjustment.id,
          reason: input.reason,
          method: "humidity_moves_toward_dehumidify_setpoint",
          metadata: { sourceMeasurementId: measurement.id, approachFactor: factor }
        };
      }),
      skipDuplicates: true
    });
    await writeAuditLog(this.prisma, {
      userId: input.operatorUser?.id,
      action: "measurement.derived_target_approach",
      entityType: "measurement_adjustment",
      entityId: adjustment.id,
      riskLevel: "high",
      reason: input.reason,
      after: { created: created.count, deviceId: input.deviceId, start: input.start, end: input.end, approachFactor: factor }
    });
    return { adjustmentId: adjustment.id, created: created.count };
  }
}
