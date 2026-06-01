import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExhibitionsService } from "./exhibitions.service";

describe("ExhibitionsService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T05:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-generates an exhibition code when omitted", async () => {
    const prisma = {
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: { profile: "REAL" } }),
      },
      exhibition: {
        findMany: vi.fn().mockResolvedValue([{ code: "EXH-20260513-001" }]),
        create: vi.fn(({ data }) =>
          Promise.resolve({ id: "exhibition-1", ...data }),
        ),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExhibitionsService(prisma as any);

    const created = await service.create({
      name: "New exhibition",
      status: "planned",
    });

    expect(created.code).toBe("EXH-20260513-002");
    expect(prisma.exhibition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "EXH-20260513-002",
        dataProfile: "REAL",
      }),
    });
  });

  it("auto-generates a scoped unit code when omitted", async () => {
    const prisma = {
      exhibition: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "exhibition-1", archivedAt: null }),
      },
      exhibitionZone: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ code: "UNIT-001" }, { code: "UNIT-003" }]),
        create: vi.fn(({ data }) => Promise.resolve({ id: "zone-1", ...data })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExhibitionsService(prisma as any);

    const created = await service.createZone("exhibition-1", {
      name: "Entrance unit",
    });

    expect(created.code).toBe("UNIT-004");
    expect(prisma.exhibitionZone.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exhibitionId: "exhibition-1",
        code: "UNIT-004",
      }),
    });
  });

  it("rejects global threshold assignments for scoped users", async () => {
    const prisma = {
      thresholdAssignment: {
        create: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExhibitionsService(prisma as any);
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["thresholds:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: [] },
    };

    await expect(
      service.assignThreshold(
        {
          profile: { connect: { id: "profile-1" } },
          priority: 100,
        } as any,
        scopedUser as any,
      ),
    ).rejects.toThrow("Scoped users must target a permitted exhibition, zone, or device.");
    expect(prisma.thresholdAssignment.create).not.toHaveBeenCalled();
  });

  it("rejects threshold assignments to devices outside a scoped user's permitted zone", async () => {
    const prisma = {
      device: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "device-outside-zone",
          dataProfile: "DEMO",
          exhibitionId: "exhibition-1",
          zoneId: "zone-outside",
        }),
      },
      thresholdAssignment: {
        create: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExhibitionsService(prisma as any);
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["thresholds:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: ["zone-allowed"] },
    };

    await expect(
      service.assignThreshold(
        {
          profile: { connect: { id: "profile-1" } },
          device: { connect: { id: "device-outside-zone" } },
          priority: 100,
        } as any,
        scopedUser as any,
      ),
    ).rejects.toThrow("Zone is outside the user's access scope");
    expect(prisma.thresholdAssignment.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes an audit log for scoped threshold assignments", async () => {
    const assignment = {
      id: "assignment-1",
      profileId: "profile-1",
      exhibitionId: "exhibition-1",
      zoneId: null,
      deviceId: null,
      priority: 100,
    };
    const prisma = {
      exhibition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "exhibition-1",
          dataProfile: "DEMO",
        }),
      },
      thresholdAssignment: {
        create: vi.fn().mockResolvedValue(assignment),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new ExhibitionsService(prisma as any);
    const scopedUser = {
      id: "manager-1",
      email: "manager@example.local",
      name: "Manager",
      roles: ["Manager"],
      permissions: ["thresholds:manage"],
      accessScope: { dataProfiles: ["DEMO"], exhibitionIds: ["exhibition-1"], zoneIds: [] },
    };

    await service.assignThreshold(
      {
        profile: { connect: { id: "profile-1" } },
        exhibition: { connect: { id: "exhibition-1" } },
        priority: 100,
      } as any,
      scopedUser as any,
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "manager-1",
        action: "threshold_assignment.create",
        entityType: "threshold_assignment",
        entityId: "assignment-1",
      }),
    });
  });
});
