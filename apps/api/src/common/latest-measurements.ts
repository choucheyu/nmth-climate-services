import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

export type LatestMeasurementByDevice = {
  id: string;
  measuredAt: Date;
  dataProfile: string;
  deviceId: string;
  exhibitionId: string | null;
  zoneId: string | null;
  source: string;
  temperatureC: number;
  humidityPercent: number;
  dehumidifySetpoint: number | null;
  qualityFlags: unknown;
  parseVersion: string;
  rawPacketId: string | null;
  rawPacketReceivedAt: Date | null;
  operatorUserId: string | null;
  adjustmentId: string | null;
  reason: string | null;
  method: string | null;
  metadata: unknown;
  createdAt: Date;
};

export async function loadLatestMeasurementsByDevice(
  prisma: Pick<PrismaService, "$queryRaw">,
  dataProfile: string,
  deviceIds: string[],
): Promise<Map<string, LatestMeasurementByDevice>> {
  if (!deviceIds.length) {
    return new Map();
  }
  const uniqueDeviceIds = Array.from(new Set(deviceIds));
  const deviceIdParams = uniqueDeviceIds.map((id) => Prisma.sql`${id}::uuid`);
  const rows = await prisma.$queryRaw<LatestMeasurementByDevice[]>`
    SELECT DISTINCT ON ("device_id")
      "id",
      "measured_at" AS "measuredAt",
      "data_profile" AS "dataProfile",
      "device_id" AS "deviceId",
      "exhibition_id" AS "exhibitionId",
      "zone_id" AS "zoneId",
      "source",
      "temperature_c" AS "temperatureC",
      "humidity_percent" AS "humidityPercent",
      "dehumidify_setpoint" AS "dehumidifySetpoint",
      "quality_flags" AS "qualityFlags",
      "parse_version" AS "parseVersion",
      "raw_packet_id" AS "rawPacketId",
      "raw_packet_received_at" AS "rawPacketReceivedAt",
      "operator_user_id" AS "operatorUserId",
      "adjustment_id" AS "adjustmentId",
      "reason",
      "method",
      "metadata",
      "created_at" AS "createdAt"
    FROM "measurements"
    WHERE "data_profile" = ${dataProfile}
      AND "device_id" IN (${Prisma.join(deviceIdParams)})
    ORDER BY "device_id", "measured_at" DESC
  `;
  return new Map(rows.map((row) => [row.deviceId, row]));
}
