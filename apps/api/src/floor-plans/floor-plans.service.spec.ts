import "reflect-metadata";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FloorPlansService } from "./floor-plans.service";

const currentAlert = {
  id: "alert-current",
  type: "humidity_threshold",
  level: "warning",
  status: "active",
  triggeredAt: new Date("2026-05-15T06:40:00.000Z"),
  message: "Humidity warning threshold exceeded",
  metadata: { metric: "humidity" },
};

const resolvedAlert = {
  id: "alert-resolved",
  type: "humidity_threshold",
  level: "warning",
  status: "resolved",
  triggeredAt: new Date("2026-05-15T05:40:00.000Z"),
  message: "Resolved humidity warning",
  metadata: { metric: "humidity" },
};
const latestMeasurement = {
  id: "measurement-13",
  measuredAt: new Date("2026-05-15T06:41:00.000Z"),
  dataProfile: "REAL",
  deviceId: "device-13",
  exhibitionId: "exhibition-1",
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
  createdAt: new Date("2026-05-15T06:41:00.000Z"),
};

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    floorPlanId: "floor-plan-1",
    version: 1,
    pdfOriginalPath: "uploads/floor-plans/plan.pdf",
    renderedImagePath: null,
    pageNumber: 1,
    width: null,
    height: null,
    renderScale: 1,
    createdByUserId: null,
    archivedAt: null,
    createdAt: new Date("2026-05-15T06:00:00.000Z"),
    ...overrides,
  };
}

function makeFloorPlan({
  dataProfile = "REAL",
  alerts = [currentAlert],
}: {
  dataProfile?: string;
  alerts?: Array<typeof currentAlert | typeof resolvedAlert>;
} = {}) {
  return {
    id: "floor-plan-1",
    dataProfile,
    exhibitionId: "exhibition-1",
    name: "Floor Plan",
    activeVersionId: "version-1",
    archivedAt: null,
    createdAt: new Date("2026-05-15T06:00:00.000Z"),
    updatedAt: new Date("2026-05-15T06:00:00.000Z"),
    exhibition: null,
    versions: [makeVersion()],
    points: [
      {
        id: "point-1",
        floorPlanId: "floor-plan-1",
        versionId: "version-1",
        name: "亞運展13",
        xRatio: 0.45,
        yRatio: 0.32,
        deviceId: "device-13",
        zoneId: null,
        thresholdProfileId: null,
        displayStyle: {},
        archivedAt: null,
        createdAt: new Date("2026-05-15T06:00:00.000Z"),
        updatedAt: new Date("2026-05-15T06:00:00.000Z"),
        device: {
          id: "device-13",
          dataProfile,
          deviceName: "00013",
          displayName: "亞運展13",
          lastSeenAt: new Date("2026-05-15T06:41:00.000Z"),
          measurements: [],
          alerts,
        },
        zone: null,
      },
    ],
  };
}

function makePrisma() {
  const prisma: any = {
    systemSetting: {
      findUnique: vi.fn(async () => ({ value: { profile: "DEMO" } })),
    },
    floorPlan: {
      findMany: vi.fn(async () => [makeFloorPlan()]),
      findFirstOrThrow: vi.fn(async () =>
        makeFloorPlan({ dataProfile: "DEMO" }),
      ),
    },
    $queryRaw: vi.fn(async () => []),
  };
  return prisma;
}

function deviceAlertsQuery(call: unknown) {
  return (call as any).include.points.include.device.include.alerts;
}

function deviceInclude(call: unknown) {
  return (call as any).include.points.include.device.include;
}

describe("FloorPlansService", () => {
  it("includes current device alerts in list payload with profile and minimal field filters", async () => {
    const prisma = makePrisma();
    const service = new FloorPlansService(prisma as never);

    const result = await service.list({ dataProfile: "REAL" });
    const alertQuery = deviceAlertsQuery(prisma.floorPlan.findMany.mock.calls[0]![0]);

    expect(alertQuery).toEqual({
      where: {
        dataProfile: "REAL",
        status: { in: ["active", "acknowledged"] },
        type: {
          in: [
            "humidity_threshold",
            "temperature_threshold",
            "device_offline",
          ],
        },
      },
      select: {
        id: true,
        type: true,
        level: true,
        status: true,
        triggeredAt: true,
        message: true,
        metadata: true,
      },
      orderBy: { triggeredAt: "desc" },
    });
    expect(alertQuery.include).toBeUndefined();
    expect(deviceInclude(prisma.floorPlan.findMany.mock.calls[0]![0]).measurements).toBeUndefined();
    expect((result as any)[0].points[0].device.alerts).toEqual([currentAlert]);
  });

  it("attaches latest point measurements separately without nested measurement includes", async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValueOnce([latestMeasurement]);
    const service = new FloorPlansService(prisma as never);

    const result = await service.list({ dataProfile: "REAL" });
    const pointDevice = (result as any)[0].points[0].device;

    expect(deviceInclude(prisma.floorPlan.findMany.mock.calls[0]![0]).measurements).toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(pointDevice).toMatchObject({
      latestMeasurement,
      measurements: [latestMeasurement],
    });
  });

  it("uses the active data profile for get alert filters", async () => {
    const prisma = makePrisma();
    const service = new FloorPlansService(prisma as never);

    await service.get("floor-plan-1");

    expect(prisma.floorPlan.findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "floor-plan-1", dataProfile: "DEMO", archivedAt: null },
      }),
    );
    const alertQuery = deviceAlertsQuery(
      prisma.floorPlan.findFirstOrThrow.mock.calls[0]![0],
    );
    expect(alertQuery.where.dataProfile).toBe("DEMO");
  });

  it("does not include resolved alerts in current floor plan alert payload", async () => {
    const prisma = makePrisma();
    prisma.floorPlan.findMany.mockImplementationOnce(async (args: any) => {
      const statusIn =
        args.include.points.include.device.include.alerts.where.status.in;
      return [
        makeFloorPlan({
          alerts: statusIn.includes("resolved")
            ? [currentAlert, resolvedAlert]
            : [currentAlert],
        }),
      ];
    });
    const service = new FloorPlansService(prisma as never);

    const result = await service.list({ dataProfile: "REAL" });
    const alertQuery = deviceAlertsQuery(prisma.floorPlan.findMany.mock.calls[0]![0]);

    expect(alertQuery.where.status.in).not.toContain("resolved");
    expect((result as any)[0].points[0].device.alerts).toEqual([currentAlert]);
  });

  it("adds rendered image URLs to floor plan version responses without exposing absolute paths", async () => {
    const prisma = makePrisma();
    prisma.floorPlan.findMany.mockResolvedValueOnce([
      {
        ...makeFloorPlan(),
        versions: [
          makeVersion({
            renderedImagePath: resolve(
              process.cwd(),
              "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
            ),
          }),
        ],
      },
    ]);
    const service = new FloorPlansService(prisma as never);

    const result = await service.list({ dataProfile: "REAL" });
    const version = (result as any)[0].versions[0];

    expect(version.renderedImageUrl).toBe(
      "/api/floor-plans/versions/version-1/rendered-image",
    );
    expect(version.renderedImagePath).toBe(
      "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
    );
  });

  it("rejects point updates that connect a device outside the floor plan exhibition", async () => {
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["floorplans:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: [] },
    };
    const prisma = {
      floorPlanPoint: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "point-1",
          zoneId: null,
          floorPlan: {
            id: "floor-plan-1",
            dataProfile: "DEMO",
            exhibitionId: "exhibition-1",
          },
        })),
        update: vi.fn(),
      },
      device: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "device-outside",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-2",
          zoneId: null,
        })),
      },
    };
    const service = new FloorPlansService(prisma as never);

    await expect(
      service.updatePoint(
        "point-1",
        { device: { connect: { id: "device-outside" } } } as never,
        scopedUser as never,
      ),
    ).rejects.toThrow("Point device must belong to the floor plan exhibition");
    expect(prisma.floorPlanPoint.update).not.toHaveBeenCalled();
  });

  it("rejects point updates that connect a zone outside the floor plan exhibition", async () => {
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["floorplans:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: [] },
    };
    const prisma = {
      floorPlanPoint: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "point-1",
          zoneId: null,
          floorPlan: {
            id: "floor-plan-1",
            dataProfile: "DEMO",
            exhibitionId: "exhibition-1",
          },
        })),
        update: vi.fn(),
      },
      exhibitionZone: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "zone-outside",
          exhibitionId: "exhibition-2",
          exhibition: { dataProfile: "DEMO" },
        })),
      },
    };
    const service = new FloorPlansService(prisma as never);

    await expect(
      service.updatePoint(
        "point-1",
        { zone: { connect: { id: "zone-outside" } } } as never,
        scopedUser as never,
      ),
    ).rejects.toThrow("Point zone must belong to the floor plan exhibition");
    expect(prisma.floorPlanPoint.update).not.toHaveBeenCalled();
  });

  it("rejects point upserts that connect a device outside the user's scoped zone", async () => {
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["floorplans:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: ["zone-allowed"] },
    };
    const prisma = {
      floorPlan: {
        findFirst: vi.fn(async () => ({
          id: "floor-plan-1",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
        })),
      },
      device: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "device-outside-zone",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
          zoneId: "zone-outside",
        })),
      },
      floorPlanPoint: {
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new FloorPlansService(prisma as never);

    await expect(
      service.upsertPoint(
        {
          floorPlanId: "floor-plan-1",
          name: "Scoped point",
          xRatio: 0.2,
          yRatio: 0.3,
          deviceId: "device-outside-zone",
        },
        scopedUser as never,
      ),
    ).rejects.toThrow("Zone is outside the user's access scope");
    expect(prisma.floorPlanPoint.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes audit logs for floor plan version creation and updates", async () => {
    const user = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["floorplans:manage"],
    };
    const version = makeVersion();
    const updatedVersion = { ...version, pageNumber: 2, renderScale: 2 };
    const prisma = {
      floorPlan: {
        findFirst: vi.fn(async () => ({
          id: "floor-plan-1",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
        })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: "floor-plan-1",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
        })),
        update: vi.fn(async () => ({ id: "floor-plan-1", activeVersionId: version.id })),
      },
      floorPlanVersion: {
        findFirst: vi.fn(async ({ where }: any) => (where.id ? version : null)),
        create: vi.fn(async () => version),
        update: vi.fn(async () => updatedVersion),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit-1" })) },
    };
    const service = new FloorPlansService(prisma as never);
    vi.spyOn(service as any, "assertUploadedPdfFile").mockResolvedValue(undefined);
    vi.spyOn(service as any, "renderVersionImage").mockResolvedValue({
      renderedImagePath: "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
      outputPath: "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
      width: 1600,
      height: 900,
    });

    await service.addVersion({
      floorPlanId: "floor-plan-1",
      pdfOriginalPath: "uploads/floor-plans/plan.pdf",
      pageNumber: 1,
      user: user as never,
    });
    await service.updateVersion("floor-plan-1", version.id, { pageNumber: 2, renderScale: 2 }, user as never);

    expect(prisma.floorPlanVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        renderedImagePath:
          "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
        width: 1600,
        height: 900,
      }),
    });
    expect(prisma.floorPlanVersion.update).toHaveBeenCalledWith({
      where: { id: version.id },
      data: expect.objectContaining({
        renderedImagePath:
          "uploads/floor-plans/rendered/floor-plan-version-version-1-hash.png",
      }),
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "manager-1",
        action: "floor_plan_version.create",
        entityType: "floor_plan_version",
        entityId: version.id,
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "manager-1",
        action: "floor_plan_version.update",
        entityType: "floor_plan_version",
        entityId: version.id,
      }),
    });
  });

  it("reports rendered image backfill plans without writing in dry-run mode", async () => {
    const version = makeVersion();
    const prisma = {
      floorPlanVersion: {
        findMany: vi.fn(async () => [version]),
        update: vi.fn(),
      },
    };
    const service = new FloorPlansService(prisma as never);

    const summary = await service.backfillRenderedImages({ limit: 10 });

    expect(summary).toMatchObject({
      scanned: 1,
      planned: 1,
      rendered: 0,
      failed: 0,
      dryRun: true,
    });
    expect(prisma.floorPlanVersion.findMany).toHaveBeenCalledWith({
      where: { id: undefined, archivedAt: null, renderedImagePath: null },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    expect(prisma.floorPlanVersion.update).not.toHaveBeenCalled();
  });

  it("writes audit logs for floor plan point creation and updates", async () => {
    const user = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["floorplans:manage"],
    };
    const beforePoint = {
      id: "point-1",
      floorPlanId: "floor-plan-1",
      versionId: null,
      name: "Old point",
      xRatio: 0.1,
      yRatio: 0.2,
      deviceId: null,
      zoneId: null,
      thresholdProfileId: null,
      displayStyle: {},
      floorPlan: { id: "floor-plan-1", dataProfile: "DEMO", exhibitionId: "exhibition-1" },
      version: null,
      device: null,
      zone: null,
    };
    const createdPoint = { ...beforePoint, id: "point-new", name: "Created point" };
    const updatedPoint = { ...beforePoint, name: "Updated point" };
    const prisma = {
      floorPlan: {
        findFirst: vi.fn(async () => ({
          id: "floor-plan-1",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
        })),
      },
      floorPlanPoint: {
        findFirstOrThrow: vi.fn(async () => beforePoint),
        create: vi.fn(async () => createdPoint),
        update: vi.fn(async () => updatedPoint),
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit-1" })) },
    };
    const service = new FloorPlansService(prisma as never);

    await service.upsertPoint(
      {
        floorPlanId: "floor-plan-1",
        name: "Created point",
        xRatio: 0.3,
        yRatio: 0.4,
      },
      user as never,
    );
    await service.updatePoint("point-1", { name: "Updated point" } as never, user as never);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "manager-1",
        action: "floor_plan_point.create",
        entityType: "floor_plan_point",
        entityId: "point-new",
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "manager-1",
        action: "floor_plan_point.update",
        entityType: "floor_plan_point",
        entityId: "point-1",
      }),
    });
  });
});
