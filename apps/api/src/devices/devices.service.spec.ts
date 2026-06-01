import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicesService } from "./devices.service";

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    dataProfile: "REAL",
    deviceName: "00001",
    displayName: "Device 00001",
    ipAddress: null,
    macAddress: null,
    groupId: null,
    exhibitionId: null,
    zoneId: null,
    pointType: "ambient",
    enabled: true,
    archivedAt: null,
    lastSeenAt: null,
    lastParseStatus: null,
    metadata: {},
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides
  };
}

function makePrisma(before = makeDevice()) {
  const prisma: any = {
    device: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findUniqueOrThrow: vi.fn(async () => before),
      update: vi.fn(async ({ data }) => ({ ...before, ...data }))
    },
    thresholdAssignment: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async ({ create, include }) => ({
        id: "assignment-1",
        ...create,
        profile: include?.profile ? { id: create.profileId } : undefined,
        device: include?.device ? before : undefined
      }))
    },
    thresholdProfile: {
      create: vi.fn(async ({ data }) => ({ id: "profile-1", ...data })),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data }))
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit-1" }))
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (operationsOrCallback: Array<Promise<unknown>> | ((tx: any) => Promise<unknown>)) =>
      Array.isArray(operationsOrCallback) ? Promise.all(operationsOrCallback) : operationsOrCallback(prisma)
    )
  };
  return prisma;
}

function makeAlerts() {
  return {
    evaluateLatestMeasurementForDevice: vi.fn(async () => true)
  };
}

describe("DevicesService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists current devices by default and excludes archived devices", async () => {
    const prisma = makePrisma();
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    await service.list({ dataProfile: "REAL" });

    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataProfile: "REAL",
          archivedAt: null
        })
      })
    );
    expect(prisma.device.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        dataProfile: "REAL",
        archivedAt: null
      })
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("keeps device lists light and attaches latest measurements separately", async () => {
    const latestMeasurement = {
      id: "measurement-1",
      measuredAt: new Date("2026-05-14T11:59:00.000Z"),
      dataProfile: "REAL",
      deviceId: "device-1",
      exhibitionId: null,
      zoneId: null,
      source: "real",
      temperatureC: 23.4,
      humidityPercent: 55.2,
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
      createdAt: new Date("2026-05-14T11:59:00.000Z")
    };
    const prisma = makePrisma();
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.device.count.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([latestMeasurement]);
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    const result = await service.list({ dataProfile: "REAL" });

    const findManyArgs = prisma.device.findMany.mock.calls[0][0];
    expect(findManyArgs.include).toMatchObject({
      group: true,
      exhibition: true,
      zone: true,
      thresholdAssignments: expect.objectContaining({ include: { profile: true }, take: 3 })
    });
    expect(findManyArgs.include).not.toHaveProperty("measurements");
    expect(findManyArgs.include).not.toHaveProperty("rawPackets");
    expect(findManyArgs.include).not.toHaveProperty("calibrations");
    expect(findManyArgs.include).not.toHaveProperty("maintenanceLogs");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      latestMeasurement,
      measurements: [latestMeasurement]
    });
  });

  it("applies receiving, paused, and archived status filters", async () => {
    const prisma = makePrisma();
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    await service.list({ dataProfile: "REAL", status: "receiving" });
    expect(prisma.device.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          enabled: true
        })
      })
    );

    await service.list({ dataProfile: "REAL", status: "paused" });
    expect(prisma.device.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          enabled: false
        })
      })
    );

    await service.list({ dataProfile: "REAL", status: "archived" });
    expect(prisma.device.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: { not: null }
        })
      })
    );
  });

  it("archives a device by disabling reception and setting archivedAt", async () => {
    const prisma = makePrisma();
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    const device = await service.archive("device-1", "user-1", "cleanup");

    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: { enabled: false, archivedAt: new Date("2026-05-14T12:00:00.000Z") }
    });
    expect(device).toMatchObject({
      enabled: false,
      archivedAt: new Date("2026-05-14T12:00:00.000Z")
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "device.archive",
        riskLevel: "high",
        reason: "cleanup"
      })
    });
  });

  it("does not refresh archivedAt when archiving an already archived device", async () => {
    const archivedAt = new Date("2026-05-10T00:00:00.000Z");
    const prisma = makePrisma(makeDevice({ enabled: false, archivedAt }));
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    const device = await service.archive("device-1", "user-1");

    expect(prisma.device.update).not.toHaveBeenCalled();
    expect(device.archivedAt).toBe(archivedAt);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "device.archive",
        after: expect.objectContaining({ archivedAt })
      })
    });
  });

  it("unarchives a device by enabling reception and clearing archivedAt", async () => {
    const prisma = makePrisma(makeDevice({ enabled: false, archivedAt: new Date("2026-05-10T00:00:00.000Z") }));
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    const device = await service.unarchive("device-1", "user-1", "restore");

    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: { enabled: true, archivedAt: null }
    });
    expect(device).toMatchObject({
      enabled: true,
      archivedAt: null
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "device.unarchive",
        riskLevel: "high",
        reason: "restore"
      })
    });
  });

  it("rejects PATCH enabled=true for archived devices", async () => {
    const prisma = makePrisma(makeDevice({ enabled: false, archivedAt: new Date("2026-05-10T00:00:00.000Z") }));
    const service = new DevicesService(prisma as never, makeAlerts() as never);

    await expect(service.update("device-1", { enabled: true }, "user-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.device.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("evaluates the latest measurement after saving a device threshold", async () => {
    const prisma = makePrisma();
    const alerts = makeAlerts();
    const service = new DevicesService(prisma as never, alerts as never);

    await service.upsertThreshold("device-1", { warningHumidityMin: 50 }, "user-1");

    expect(prisma.thresholdProfile.create).toHaveBeenCalled();
    expect(prisma.thresholdAssignment.upsert).toHaveBeenCalled();
    expect(alerts.evaluateLatestMeasurementForDevice).toHaveBeenCalledWith("device-1", "REAL");
  });
});
