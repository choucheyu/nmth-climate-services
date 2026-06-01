import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeasurementsService, REPORT_MAX_SOURCE_ROWS } from "./measurements.service";

const measuredAt = new Date("2026-05-12T02:00:00.000Z");
const latestMeasurement = {
  id: "measurement-1",
  measuredAt,
  dataProfile: "REAL",
  deviceId: "device-1",
  exhibitionId: "exhibition-1",
  zoneId: null,
  source: "real",
  temperatureC: 23,
  humidityPercent: 55,
  dehumidifySetpoint: null,
  qualityFlags: [],
  parseVersion: "usr-c215-v1",
  rawPacketId: null,
  rawPacketReceivedAt: null,
  operatorUserId: null,
  adjustmentId: null,
  reason: null,
  method: null,
  metadata: {},
  createdAt: measuredAt
};

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    deviceName: "00001",
    displayName: "女人展測點",
    lastSeenAt: new Date(),
    measurements: [
      {
        measuredAt,
        temperatureC: 23,
        humidityPercent: 55,
        source: "real"
      }
    ],
    alerts: [],
    exhibition: null,
    zone: null,
    ...overrides
  };
}

describe("MeasurementsService.latestOverview", () => {
  it("resolves stale threshold alerts and excludes them from current warning counts", async () => {
    const prisma = {
      device: {
        findMany: vi.fn(async () => [
          makeDevice({
            alerts: [
              {
                id: "alert-1",
                type: "humidity_threshold",
                level: "warning",
                status: "active",
                metadata: {
                  thresholdMetric: "humidity",
                  thresholdDirection: "above",
                  thresholdLimit: 60
                },
                triggeredAt: new Date("2026-05-12T01:00:00.000Z")
              }
            ]
          })
        ])
      },
      alert: {
        update: vi.fn(async () => ({ id: "alert-1", status: "resolved" }))
      },
      $queryRaw: vi.fn(async () => [latestMeasurement])
    };
    const service = new MeasurementsService(prisma as never);

    const overview = await service.latestOverview("exhibition-1", "REAL");

    expect(overview.summary.warning).toBe(0);
    expect(overview.summary.normal).toBe(1);
    expect(overview.devices[0]).toMatchObject({
      latestMeasurement,
      measurements: [latestMeasurement]
    });
    expect(overview.sources.warning).toEqual([]);
    expect(overview.sources.resolvedAlertIds).toEqual(["alert-1"]);
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({ measurements: expect.anything() })
      })
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-1" },
        data: expect.objectContaining({ status: "resolved", resolvedAt: measuredAt })
      })
    );
  });

  it("counts device_offline only as offline, not threshold warning", async () => {
    const prisma = {
      device: {
        findMany: vi.fn(async () => [
          makeDevice({
            lastSeenAt: new Date("2026-05-12T01:00:00.000Z"),
            alerts: [
              {
                id: "offline-alert",
                type: "device_offline",
                level: "warning",
                status: "active",
                metadata: {},
                triggeredAt: new Date("2026-05-12T01:30:00.000Z")
              }
            ]
          })
        ])
      },
      alert: {
        update: vi.fn()
      },
      $queryRaw: vi.fn(async () => [latestMeasurement])
    };
    const service = new MeasurementsService(prisma as never);

    const overview = await service.latestOverview("exhibition-1", "REAL");

    expect(overview.summary.warning).toBe(0);
    expect(overview.summary.offline).toBe(1);
    expect(overview.sources.offline[0]).toMatchObject({
      deviceId: "device-1",
      alertIds: ["offline-alert"],
      alertTypes: ["device_offline"]
    });
  });
});

describe("MeasurementsService.latestByDevice", () => {
  it("returns lightweight latest telemetry and active alert state for scoped floor-plan refreshes", async () => {
    const currentAlert = {
      id: "alert-1",
      type: "humidity_threshold",
      level: "warning",
      status: "active",
      triggeredAt: new Date("2026-05-12T01:55:00.000Z"),
      message: "Humidity above threshold",
      metadata: { thresholdMetric: "humidity" }
    };
    const prisma = {
      device: {
        findMany: vi.fn(async () => [
          {
            id: "device-1",
            deviceName: "00001",
            displayName: "女人展測點",
            exhibitionId: "exhibition-1",
            zoneId: "zone-1",
            lastSeenAt: measuredAt,
            alerts: [currentAlert]
          }
        ])
      },
      $queryRaw: vi.fn(async () => [latestMeasurement])
    };
    const service = new MeasurementsService(prisma as never);

    const result = await service.latestByDevice({ exhibitionId: "exhibition-1", dataProfile: "REAL", deviceIds: "device-1,device-2" });

    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataProfile: "REAL",
          exhibitionId: "exhibition-1",
          enabled: true,
          archivedAt: null,
          id: { in: ["device-1", "device-2"] }
        }),
        select: expect.objectContaining({
          alerts: expect.objectContaining({
            where: expect.objectContaining({
              status: { in: ["active", "acknowledged"] }
            })
          })
        })
      })
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      {
        deviceId: "device-1",
        deviceName: "00001",
        displayName: "女人展測點",
        exhibitionId: "exhibition-1",
        zoneId: "zone-1",
        lastSeenAt: measuredAt,
        latestMeasurement,
        measurements: [latestMeasurement],
        alerts: [currentAlert],
        currentAlerts: [currentAlert]
      }
    ]);
  });
});

describe("MeasurementsService.reportRows", () => {
  function makeMeasurement(overrides: Record<string, unknown> = {}) {
    return {
      measuredAt,
      deviceId: "device-1",
      device: { id: "device-1", deviceName: "00001", displayName: "Point 1" },
      exhibition: { name: "Exhibition 1" },
      zone: { name: "Zone A" },
      dehumidifySetpoint: 52,
      temperatureC: 23.45,
      humidityPercent: 55.55,
      source: "real",
      dataProfile: "REAL",
      qualityFlags: [],
      ...overrides
    };
  }

  it("preserves device identity when filtering and aggregating multiple deviceIds", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn(async () => [
          makeMeasurement(),
          makeMeasurement({
            deviceId: "device-2",
            device: { id: "device-2", deviceName: "00002", displayName: "Point 2" },
            temperatureC: 25,
            humidityPercent: 60
          })
        ])
      }
    };
    const service = new MeasurementsService(prisma as never);

    const rows = await service.reportRows({
      start: new Date("2026-05-12T01:55:00.000Z"),
      end: new Date("2026-05-12T02:05:00.000Z"),
      interval: "5m",
      dataProfile: "REAL",
      deviceIds: ["device-1", "device-2"]
    });

    expect(prisma.measurement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataProfile: "REAL",
          deviceId: { in: ["device-1", "device-2"] }
        })
      })
    );
    const findMany = prisma.measurement.findMany as unknown as { mock: { calls: Array<[Record<string, unknown>]> } };
    expect(findMany.mock.calls[0]?.[0]?.take).toBe(REPORT_MAX_SOURCE_ROWS + 1);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.deviceId).sort()).toEqual(["device-1", "device-2"]);
    expect(rows.map((row) => row.deviceName).sort()).toEqual(["00001", "00002"]);
  });

  it("keeps deviceId backward compatibility alongside deviceIds", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn(async () => [makeMeasurement()])
      }
    };
    const service = new MeasurementsService(prisma as never);

    await service.reportRows({
      start: new Date("2026-05-12T01:55:00.000Z"),
      end: new Date("2026-05-12T02:05:00.000Z"),
      interval: "raw",
      dataProfile: "REAL",
      deviceId: "device-1"
    });

    expect(prisma.measurement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: "device-1" })
      })
    );
  });

  it("parses false report query flags without accidentally including compensated or derived rows", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn(async () => [makeMeasurement()])
      }
    };
    const service = new MeasurementsService(prisma as never);

    await service.reportRows({
      start: new Date("2026-05-12T01:55:00.000Z"),
      end: new Date("2026-05-12T02:05:00.000Z"),
      interval: "raw",
      dataProfile: "REAL",
      deviceId: "device-1",
      includeCompensated: "false",
      includeSynthetic: "false"
    });

    expect(prisma.measurement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: { in: ["real", "imported", "manual"] } })
      })
    );
  });

  it("rejects full-data report queries without a selected device", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn()
      }
    };
    const service = new MeasurementsService(prisma as never);

    await expect(
      service.reportRows({
        start: new Date("2026-05-12T01:55:00.000Z"),
        end: new Date("2026-05-12T02:05:00.000Z"),
        interval: "raw",
        dataProfile: "REAL"
      })
    ).rejects.toThrow(BadRequestException);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });

  it("does not allow scoped DEMO users to query REAL report rows", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn()
      }
    };
    const service = new MeasurementsService(prisma as never);

    await expect(
      service.reportRows(
        {
          start: new Date("2026-05-12T01:55:00.000Z"),
          end: new Date("2026-05-12T02:05:00.000Z"),
          interval: "raw",
          dataProfile: "REAL",
          deviceId: "device-1"
        },
        {
          id: "viewer-1",
          email: "viewer@example.local",
          name: "Demo Viewer",
          roles: ["Viewer"],
          permissions: ["reports:read"],
          accessScope: { dataProfiles: ["DEMO"], exhibitionIds: [], zoneIds: [] }
        }
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });
});

describe("MeasurementsService.trend24h", () => {
  it("rejects all-device trend reads when no device is selected", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn()
      }
    };
    const service = new MeasurementsService(prisma as never);

    await expect(service.trend24h({ exhibitionId: "exhibition-1", dataProfile: "REAL" })).rejects.toThrow(BadRequestException);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });
});
