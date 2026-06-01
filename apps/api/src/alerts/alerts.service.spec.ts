import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { AlertsService } from "./alerts.service";

const latestAt = new Date("2026-05-15T00:01:01.200Z");
const previousAt = new Date("2026-05-15T00:00:00.000Z");

function makeMeasurement(overrides: Record<string, unknown> = {}) {
  return {
    id: "measurement-latest",
    measuredAt: latestAt,
    deviceId: "device-1",
    exhibitionId: "exhibition-1",
    zoneId: "zone-1",
    temperatureC: 23.1,
    humidityPercent: 44.5,
    source: "real",
    dataProfile: "REAL",
    ...overrides
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    name: "Device threshold",
    warningTemperatureMin: 18,
    warningTemperatureMax: 25,
    criticalTemperatureMin: null,
    criticalTemperatureMax: null,
    warningHumidityMin: 50,
    warningHumidityMax: 60,
    criticalHumidityMin: null,
    criticalHumidityMax: null,
    triggerDurationMinutes: 1,
    recoveryDurationMinutes: 10,
    hysteresis: 1,
    repeatIntervalMinutes: 60,
    maxNotifications: 3,
    unresolvedReminderMinutes: 1440,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides
  };
}

function makeAssignment(profile = makeProfile()) {
  return {
    id: "assignment-1",
    profileId: profile.id,
    exhibitionId: "exhibition-1",
    zoneId: "zone-1",
    deviceId: "device-1",
    priority: 1,
    activeFrom: null,
    activeUntil: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    profile
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => null)
    },
    alert: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: "alert-1", ...data })),
      update: vi.fn(async ({ data }) => ({ id: "alert-1", ...data }))
    },
    alertSilenceWindow: {
      findMany: vi.fn(async () => [])
    },
    thresholdAssignment: {
      findFirst: vi.fn(async () => makeAssignment())
    },
    measurement: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null)
    },
    device: {
      findMany: vi.fn(async () => [])
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    ...overrides
  };
  return prisma;
}

describe("AlertsService.list", () => {
  it("omits empty filters from Prisma where and clamps page size", async () => {
    const prisma = makePrisma();
    const service = new AlertsService(prisma as never);

    await service.list({ dataProfile: "REAL", status: "", level: "all", type: "", deviceId: "", page: Number.NaN, pageSize: 250 });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dataProfile: "REAL" },
        skip: 0,
        take: 100
      })
    );
    expect(prisma.alert.count).toHaveBeenCalledWith({ where: { dataProfile: "REAL" } });
  });

  it("keeps valid status and level filters", async () => {
    const prisma = makePrisma();
    const service = new AlertsService(prisma as never);

    await service.list({ dataProfile: "REAL", status: "active", level: "warning" });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dataProfile: "REAL", status: "active", level: "warning" }
      })
    );
  });
});

describe("AlertsService threshold evaluation", () => {
  it("triggers a sustained breach when one-minute samples are delayed by jitter", async () => {
    const latest = makeMeasurement();
    const previous = makeMeasurement({ id: "measurement-previous", measuredAt: previousAt, humidityPercent: 45.1 });
    const prisma = makePrisma({
      measurement: {
        findMany: vi.fn(async () => [latest, previous]),
        findFirst: vi.fn(async () => latest)
      }
    });
    const service = new AlertsService(prisma as never);

    await service.evaluateMeasurement(latest);

    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dataProfile: "REAL",
        deviceId: "device-1",
        type: "humidity_threshold",
        status: "active",
        metadata: expect.objectContaining({
          exceededMinutes: 1
        })
      })
    });
  });

  it("does not trigger a sustained breach when duration is insufficient", async () => {
    const latest = makeMeasurement();
    const previous = makeMeasurement({
      id: "measurement-previous",
      measuredAt: new Date(latestAt.getTime() - 30_000),
      humidityPercent: 45.1
    });
    const prisma = makePrisma({
      measurement: {
        findMany: vi.fn(async () => [latest, previous]),
        findFirst: vi.fn(async () => latest)
      }
    });
    const service = new AlertsService(prisma as never);

    await service.evaluateMeasurement(latest);

    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it("resolves active threshold alerts when a measurement recovers", async () => {
    const normal = makeMeasurement({ humidityPercent: 52.5 });
    const activeAlert = { id: "alert-1", metadata: {}, status: "active" };
    const prisma = makePrisma({
      alert: {
        findMany: vi.fn(async ({ where }) => (where.type?.in?.includes("humidity_threshold") ? [activeAlert] : [])),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(async ({ data }) => ({ id: "alert-1", ...data }))
      }
    });
    const service = new AlertsService(prisma as never);

    await service.evaluateMeasurement(normal);

    expect(prisma.alert.update).toHaveBeenCalledWith({
      where: { id: "alert-1" },
      data: expect.objectContaining({
        status: "resolved",
        resolvedAt: normal.measuredAt
      })
    });
    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dataProfile: "REAL",
          deviceId: "device-1"
        })
      })
    );
  });

  it("refreshes an active same-profile threshold alert instead of creating a duplicate", async () => {
    const latest = makeMeasurement();
    const prisma = makePrisma({
      thresholdAssignment: {
        findFirst: vi.fn(async () => makeAssignment(makeProfile({ triggerDurationMinutes: 0 })))
      },
      alert: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => ({
          id: "alert-existing",
          status: "active",
          triggeredAt: new Date("2026-05-14T23:00:00.000Z"),
          metadata: { notificationCount: 1 }
        })),
        create: vi.fn(),
        update: vi.fn(async ({ data }) => ({ id: "alert-existing", ...data }))
      }
    });
    const service = new AlertsService(prisma as never);

    await service.evaluateMeasurement(latest);

    expect(prisma.alert.findFirst).toHaveBeenCalledWith({
      where: {
        dataProfile: "REAL",
        deviceId: "device-1",
        type: "humidity_threshold",
        status: { in: ["active", "acknowledged"] }
      }
    });
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.alert.update).toHaveBeenCalled();
  });
});

describe("AlertsService offline detection", () => {
  it("does not duplicate active offline alerts", async () => {
    const offlineDevice = {
      id: "device-1",
      dataProfile: "REAL",
      displayName: "Device 00001",
      exhibitionId: "exhibition-1",
      zoneId: "zone-1",
      lastSeenAt: new Date("2026-05-14T23:55:00.000Z")
    };
    const prisma = makePrisma({
      device: {
        findMany: vi.fn(async () => [offlineDevice])
      },
      alert: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => ({ id: "offline-alert" })),
        create: vi.fn(),
        update: vi.fn()
      }
    });
    const service = new AlertsService(prisma as never);

    await service.detectOffline(3, "REAL");

    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it("resolves recovered offline alerts only inside the user's resource scope", async () => {
    const scopedUser = {
      id: "admin-1",
      email: "admin@example.local",
      name: "Scoped Admin",
      roles: ["Admin"],
      permissions: ["devices:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: ["zone-1"] },
    };
    const prisma = makePrisma({
      alert: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(),
      },
      device: {
        findMany: vi.fn(async () => []),
      },
    });
    const service = new AlertsService(prisma as never);

    await service.detectOffline(3, "DEMO", scopedUser as any);

    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: {
        dataProfile: "DEMO",
        exhibitionId: "exhibition-1",
        zoneId: "zone-1",
        type: "device_offline",
        status: { in: ["active", "acknowledged"] },
      },
      include: { device: true },
    });
  });

  it("resolves an offline alert when a device sends data again", async () => {
    const offlineAlert = { id: "offline-alert", status: "active", metadata: {} };
    const prisma = makePrisma({
      alert: {
        findMany: vi.fn(async ({ where }) => (where.type === "device_offline" ? [offlineAlert] : [])),
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(async ({ data }) => ({ id: "offline-alert", ...data }))
      },
      thresholdAssignment: {
        findFirst: vi.fn(async () => null)
      }
    });
    const service = new AlertsService(prisma as never);

    await service.evaluateMeasurement(makeMeasurement({ humidityPercent: 52.5 }));

    expect(prisma.alert.update).toHaveBeenCalledWith({
      where: { id: "offline-alert" },
      data: expect.objectContaining({
        status: "resolved"
      })
    });
  });
});

describe("AlertsService.repairThresholdAlerts", () => {
  it("reports dry-run summary for missing sustained threshold alerts", async () => {
    const latest = makeMeasurement();
    const previous = makeMeasurement({ id: "measurement-previous", measuredAt: previousAt, humidityPercent: 45.1 });
    const prisma = makePrisma({
      device: {
        findMany: vi.fn(async () => [
          {
            id: "device-1",
            dataProfile: "REAL",
            deviceName: "00001",
            exhibitionId: "exhibition-1",
            zoneId: "zone-1",
            enabled: true,
            archivedAt: null,
            measurements: [latest]
          }
        ])
      },
      measurement: {
        findMany: vi.fn(async () => [latest, previous]),
        findFirst: vi.fn(async () => latest)
      }
    });
    const service = new AlertsService(prisma as never);

    const summary = await service.repairThresholdAlerts({ dataProfile: "REAL" });

    expect(summary).toMatchObject({
      dataProfile: "REAL",
      dryRun: true,
      scannedDeviceCount: 1,
      thresholdAssignedDeviceCount: 1,
      violatingDeviceCount: 1,
      alertsCreated: 0,
      alertsWouldCreate: 1,
      errorCount: 0
    });
    expect(summary.skipReasons.dry_run_would_create).toBe(1);
  });
});
