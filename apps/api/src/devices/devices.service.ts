import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AlertsService } from "../alerts/alerts.service";
import { PrismaService } from "../prisma/prisma.service";
import { assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { normalizeDataProfile } from "../common/data-profile";
import { loadLatestMeasurementsByDevice } from "../common/latest-measurements";

type Actor = RequestUser | string | undefined;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertsService: AlertsService
  ) {}

  async list(
    query: { search?: string; exhibitionId?: string; zoneId?: string; status?: string; dataProfile?: string; page?: number; pageSize?: number },
    user?: RequestUser
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    const statusWhere = this.buildStatusWhere(query.status);
    const where: Prisma.DeviceWhereInput = {
      dataProfile,
      exhibitionId: scopedIdFilter(user, "exhibitionId", query.exhibitionId),
      zoneId: scopedIdFilter(user, "zoneId", query.zoneId),
      ...statusWhere,
      OR: query.search
        ? [
            { deviceName: { contains: query.search, mode: "insensitive" } },
            { displayName: { contains: query.search, mode: "insensitive" } }
          ]
        : undefined
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.device.findMany({
        where,
        include: {
          group: true,
          exhibition: true,
          zone: true,
          thresholdAssignments: {
            include: { profile: true },
            orderBy: { priority: "asc" },
            take: 3
          }
        },
        orderBy: [{ enabled: "desc" }, { deviceName: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.device.count({ where })
    ]);
    const latestMeasurements = await loadLatestMeasurementsByDevice(this.prisma, dataProfile, items.map((item) => item.id));
    const enrichedItems = items.map((item) => {
      const latestMeasurement = latestMeasurements.get(item.id) ?? null;
      return {
        ...item,
        latestMeasurement,
        measurements: latestMeasurement ? [latestMeasurement] : []
      };
    });
    return { items: enrichedItems, total, page, pageSize, dataProfile };
  }

  async exportCsv(query: { search?: string; exhibitionId?: string; status?: string; dataProfile?: string }, user?: RequestUser) {
    const result = await this.list({ ...query, page: 1, pageSize: 10000 }, user);
    const headers = ["dataProfile", "deviceName", "displayName", "ipAddress", "macAddress", "exhibition", "zone", "enabled", "lastSeenAt"];
    const lines = [headers.join(",")];
    for (const device of result.items) {
      lines.push(
        [
          result.dataProfile,
          device.deviceName,
          device.displayName,
          device.ipAddress ?? "",
          device.macAddress ?? "",
          device.exhibition?.name ?? "",
          device.zone?.name ?? "",
          String(device.enabled),
          device.lastSeenAt?.toISOString() ?? ""
        ]
          .map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`)
          .join(",")
      );
    }
    return `\uFEFF${lines.join("\n")}`;
  }

  async get(id: string, user?: RequestUser) {
    const dataProfile = await resolveScopedDataProfile(this.prisma, user);
    const device = await this.prisma.device.findFirstOrThrow({
      where: { id, dataProfile },
      include: {
        group: true,
        exhibition: true,
        zone: true,
        calibrations: { orderBy: { calibratedAt: "desc" } },
        maintenanceLogs: { orderBy: { performedAt: "desc" } },
        statusEvents: { orderBy: { startedAt: "desc" }, take: 50 },
        replacedByHistory: true,
        replacementForHistory: true,
        rawPackets: { orderBy: { receivedAt: "desc" }, take: 10 },
        thresholdAssignments: { include: { profile: true }, orderBy: { priority: "asc" } },
        measurements: { where: { dataProfile }, orderBy: { measuredAt: "desc" }, take: 24 }
      }
    });
    assertScopedResourceIds(user, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    return device;
  }

  async create(input: Prisma.DeviceCreateInput, user?: Actor) {
    const scopedUser = this.actorUser(user);
    const dataProfile = assertDataProfileAllowed(
      scopedUser,
      typeof input.dataProfile === "string" ? normalizeDataProfile(input.dataProfile) : await resolveScopedDataProfile(this.prisma, scopedUser)
    );
    assertScopedResourceIds(scopedUser, {
      exhibitionId: this.connectId(input.exhibition),
      zoneId: this.connectId(input.zone)
    });
    const device = await this.prisma.device.create({ data: { ...input, dataProfile } });
    await writeAuditLog(this.prisma, {
      userId: this.actorId(user),
      action: "device.create",
      entityType: "device",
      entityId: device.id,
      after: device
    });
    return device;
  }

  async update(id: string, input: Prisma.DeviceUpdateInput, user?: Actor) {
    const scopedUser = this.actorUser(user);
    const before = await this.prisma.device.findUniqueOrThrow({ where: { id } });
    assertDataProfileAllowed(scopedUser, before.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: before.exhibitionId, zoneId: before.zoneId });
    assertScopedResourceIds(scopedUser, {
      exhibitionId: this.connectId(input.exhibition),
      zoneId: this.connectId(input.zone)
    });
    if (before.archivedAt != null && this.requestsEnabled(input.enabled)) {
      throw new BadRequestException("Device is archived. Unarchive it before enabling data reception.");
    }
    const device = await this.prisma.device.update({ where: { id }, data: input });
    await writeAuditLog(this.prisma, {
      userId: this.actorId(user),
      action: "device.update",
      entityType: "device",
      entityId: id,
      before,
      after: device
    });
    return device;
  }

  async archive(id: string, user?: Actor, reason?: string) {
    const scopedUser = this.actorUser(user);
    const before = await this.prisma.device.findUniqueOrThrow({ where: { id } });
    assertDataProfileAllowed(scopedUser, before.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: before.exhibitionId, zoneId: before.zoneId });
    const device =
      before.archivedAt != null && before.enabled === false
        ? before
        : await this.prisma.device.update({
            where: { id },
            data: { enabled: false, archivedAt: before.archivedAt ?? new Date() }
          });
    await writeAuditLog(this.prisma, {
      userId: this.actorId(user),
      action: "device.archive",
      entityType: "device",
      entityId: id,
      riskLevel: "high",
      before,
      after: device,
      reason
    });
    return device;
  }

  async unarchive(id: string, user?: Actor, reason?: string) {
    const scopedUser = this.actorUser(user);
    const before = await this.prisma.device.findUniqueOrThrow({ where: { id } });
    assertDataProfileAllowed(scopedUser, before.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: before.exhibitionId, zoneId: before.zoneId });
    const device = await this.prisma.device.update({
      where: { id },
      data: { enabled: true, archivedAt: null }
    });
    await writeAuditLog(this.prisma, {
      userId: this.actorId(user),
      action: "device.unarchive",
      entityType: "device",
      entityId: id,
      riskLevel: "high",
      before,
      after: device,
      reason
    });
    return device;
  }

  async replace(input: { oldDeviceId: string; newDeviceName: string; reason?: string; user?: Actor }) {
    const scopedUser = this.actorUser(input.user);
    const oldDevice = await this.prisma.device.findUniqueOrThrow({ where: { id: input.oldDeviceId } });
    assertDataProfileAllowed(scopedUser, oldDevice.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: oldDevice.exhibitionId, zoneId: oldDevice.zoneId });
    const newDevice = await this.prisma.device.upsert({
      where: { dataProfile_deviceName: { dataProfile: oldDevice.dataProfile, deviceName: input.newDeviceName } },
      update: {
        dataProfile: oldDevice.dataProfile,
        exhibitionId: oldDevice.exhibitionId,
        zoneId: oldDevice.zoneId,
        groupId: oldDevice.groupId,
        pointType: oldDevice.pointType,
        ipAddress: oldDevice.ipAddress,
        macAddress: oldDevice.macAddress,
        enabled: true,
        archivedAt: null
      },
      create: {
        dataProfile: oldDevice.dataProfile,
        deviceName: input.newDeviceName,
        displayName: `${oldDevice.displayName} replacement`,
        exhibitionId: oldDevice.exhibitionId,
        zoneId: oldDevice.zoneId,
        groupId: oldDevice.groupId,
        ipAddress: oldDevice.ipAddress,
        macAddress: oldDevice.macAddress,
        pointType: oldDevice.pointType
      }
    });
    await this.prisma.$transaction([
      this.prisma.floorPlanPoint.updateMany({
        where: { deviceId: oldDevice.id },
        data: { deviceId: newDevice.id }
      }),
      this.prisma.deviceReplacementHistory.create({
        data: {
          oldDeviceId: oldDevice.id,
          newDeviceId: newDevice.id,
          replacedAt: new Date(),
          reason: input.reason
        }
      })
    ]);
    await writeAuditLog(this.prisma, {
      userId: this.actorId(input.user),
      action: "device.replace",
      entityType: "device",
      entityId: oldDevice.id,
      riskLevel: "high",
      before: oldDevice,
      after: { newDevice },
      reason: input.reason
    });
    return { oldDevice, newDevice };
  }

  async addCalibration(deviceId: string, input: { calibratedAt: Date; validUntil?: Date; certificateUrl?: string; note?: string }, user?: Actor) {
    const scopedUser = this.actorUser(user);
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    assertDataProfileAllowed(scopedUser, device.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    return this.prisma.deviceCalibration.create({
      data: {
        deviceId,
        calibratedAt: input.calibratedAt,
        validUntil: input.validUntil,
        certificateUrl: input.certificateUrl,
        note: input.note
      }
    });
  }

  async addMaintenance(deviceId: string, input: { type: string; performedAt: Date; performedBy?: string; note?: string }, user?: Actor) {
    const scopedUser = this.actorUser(user);
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    assertDataProfileAllowed(scopedUser, device.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    return this.prisma.deviceMaintenanceLog.create({
      data: {
        deviceId,
        type: input.type,
        performedAt: input.performedAt,
        performedBy: input.performedBy,
        note: input.note
      }
    });
  }

  private buildStatusWhere(status?: string): Prisma.DeviceWhereInput {
    switch (status ?? "active") {
      case "active":
      case "current":
        return { archivedAt: null };
      case "receiving":
        return { archivedAt: null, enabled: true };
      case "paused":
        return { archivedAt: null, enabled: false };
      case "archived":
        return { archivedAt: { not: null } };
      case "all":
        return {};
      default:
        throw new BadRequestException("Unsupported device status filter.");
    }
  }

  private requestsEnabled(enabled: Prisma.DeviceUpdateInput["enabled"]): boolean {
    if (enabled === true) {
      return true;
    }
    if (enabled && typeof enabled === "object" && "set" in enabled) {
      return enabled.set === true;
    }
    return false;
  }

  async upsertThreshold(
    deviceId: string,
    input: {
      name?: string;
      warningTemperatureMin?: number | null;
      warningTemperatureMax?: number | null;
      warningHumidityMin?: number | null;
      warningHumidityMax?: number | null;
      triggerDurationMinutes?: number;
      repeatIntervalMinutes?: number;
      maxNotifications?: number;
      unresolvedReminderMinutes?: number;
    },
    user?: Actor
  ) {
    const scopedUser = this.actorUser(user);
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    assertDataProfileAllowed(scopedUser, device.dataProfile);
    assertScopedResourceIds(scopedUser, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    const existing = await this.prisma.thresholdAssignment.findFirst({
      where: { deviceId },
      include: { profile: true },
      orderBy: { priority: "asc" }
    });
    const profileData = {
      name: input.name ?? `${device.displayName} threshold`,
      warningTemperatureMin: input.warningTemperatureMin ?? 18,
      warningTemperatureMax: input.warningTemperatureMax ?? 25,
      warningHumidityMin: input.warningHumidityMin ?? 50,
      warningHumidityMax: input.warningHumidityMax ?? 60,
      triggerDurationMinutes: input.triggerDurationMinutes ?? 10,
      repeatIntervalMinutes: input.repeatIntervalMinutes ?? 60,
      maxNotifications: input.maxNotifications ?? 3,
      unresolvedReminderMinutes: input.unresolvedReminderMinutes ?? 1440
    };
    const before = existing ?? null;
    const assignment = await this.prisma.$transaction(async (tx) => {
      const profile = existing
        ? await tx.thresholdProfile.update({ where: { id: existing.profileId }, data: profileData })
        : await tx.thresholdProfile.create({ data: profileData });
      return tx.thresholdAssignment.upsert({
        where: { id: existing?.id ?? "00000000-0000-4000-8000-000000000000" },
        update: {
          profileId: profile.id,
          priority: 1,
          exhibitionId: device.exhibitionId,
          zoneId: device.zoneId,
          deviceId
        },
        create: {
          profileId: profile.id,
          priority: 1,
          exhibitionId: device.exhibitionId,
          zoneId: device.zoneId,
          deviceId
        },
        include: { profile: true, device: true }
      });
    });
    await writeAuditLog(this.prisma, {
      userId: this.actorId(user),
      action: "device.threshold.upsert",
      entityType: "device",
      entityId: deviceId,
      before,
      after: assignment
    });
    await this.alertsService.evaluateLatestMeasurementForDevice(deviceId, device.dataProfile);
    return assignment;
  }

  private connectId(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const connect = (value as { connect?: { id?: unknown } }).connect;
    return typeof connect?.id === "string" ? connect.id : null;
  }

  private actorUser(actor: Actor): RequestUser | undefined {
    return actor && typeof actor === "object" ? actor : undefined;
  }

  private actorId(actor: Actor): string | undefined {
    return typeof actor === "string" ? actor : actor?.id;
  }
}
