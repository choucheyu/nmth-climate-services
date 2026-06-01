import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { accessScopeFor, assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { normalizeDataProfile } from "../common/data-profile";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ExhibitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    search?: string;
    status?: string;
    dataProfile?: string;
    page?: number;
    pageSize?: number;
  }, user?: RequestUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, query.dataProfile);
    const where: Prisma.ExhibitionWhereInput = {
      dataProfile,
      id: scopedIdFilter(user, "exhibitionId"),
      zones: scopedIdFilter(user, "zoneId") ? { some: { id: scopedIdFilter(user, "zoneId") } } : undefined,
      status: query.status,
      archivedAt: null,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.exhibition.findMany({
        where,
        include: {
          zones: { where: { archivedAt: null, id: scopedIdFilter(user, "zoneId") }, orderBy: { code: "asc" } },
          floorPlans: {
            where: { archivedAt: null },
            include: {
              versions: {
                where: { archivedAt: null },
                orderBy: { version: "desc" },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          devices: { where: { zoneId: scopedIdFilter(user, "zoneId") }, take: 100, orderBy: { deviceName: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.exhibition.count({ where }),
    ]);
    return { items, total, page, pageSize, dataProfile };
  }

  async get(id: string, user?: RequestUser) {
    const dataProfile = await resolveScopedDataProfile(this.prisma, user);
    assertScopedResourceIds(user, { exhibitionId: id });
    return this.prisma.exhibition.findFirstOrThrow({
      where: { id, dataProfile },
      include: {
        zones: { where: { archivedAt: null, id: scopedIdFilter(user, "zoneId") }, orderBy: { code: "asc" } },
        devices: { where: { zoneId: scopedIdFilter(user, "zoneId") }, orderBy: { deviceName: "asc" } },
        floorPlans: {
          where: { archivedAt: null },
          include: {
            versions: {
              where: { archivedAt: null },
              orderBy: { version: "desc" },
            },
            points: {
              where: { archivedAt: null },
              include: { device: true, zone: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        thresholdAssignments: { include: { profile: true } },
      },
    });
  }

  async create(
    data: Omit<Prisma.ExhibitionCreateInput, "code"> & { code?: string },
    user?: RequestUser,
  ) {
    const dataProfile =
      typeof data.dataProfile === "string"
        ? assertDataProfileAllowed(user, normalizeDataProfile(data.dataProfile))
        : await resolveScopedDataProfile(this.prisma, user);
    const code =
      data.code?.trim() || (await this.generateExhibitionCode(dataProfile));
    const exhibition = await this.prisma.exhibition.create({
      data: { ...data, code, dataProfile },
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "exhibition.create",
      entityType: "exhibition",
      entityId: exhibition.id,
      after: exhibition,
    });
    return exhibition;
  }

  async update(
    id: string,
    data: Prisma.ExhibitionUpdateInput,
    user?: RequestUser,
  ) {
    const before = await this.prisma.exhibition.findUniqueOrThrow({
      where: { id },
    });
    assertDataProfileAllowed(user, before.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: before.id });
    const exhibition = await this.prisma.exhibition.update({
      where: { id },
      data,
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "exhibition.update",
      entityType: "exhibition",
      entityId: id,
      before,
      after: exhibition,
    });
    return exhibition;
  }

  async archive(id: string, reason: string | undefined, user?: RequestUser) {
    const before = await this.prisma.exhibition.findUniqueOrThrow({
      where: { id },
    });
    assertDataProfileAllowed(user, before.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: before.id });
    const exhibition = await this.prisma.exhibition.update({
      where: { id },
      data: { archivedAt: new Date(), status: "archived" },
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "exhibition.archive",
      entityType: "exhibition",
      entityId: id,
      riskLevel: "high",
      before,
      after: exhibition,
      reason,
    });
    return exhibition;
  }

  async createZone(
    exhibitionId: string,
    data: { code?: string; name: string; description?: string },
    user?: RequestUser,
  ) {
    const exhibition = await this.prisma.exhibition.findFirstOrThrow({
      where: { id: exhibitionId, archivedAt: null },
    });
    assertDataProfileAllowed(user, exhibition.dataProfile);
    assertScopedResourceIds(user, { exhibitionId });
    const code =
      data.code?.trim() || (await this.generateZoneCode(exhibition.id));
    const zone = await this.prisma.exhibitionZone.create({
      data: {
        exhibitionId,
        code,
        name: data.name,
        description: data.description,
      },
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "exhibition_zone.create",
      entityType: "exhibition_zone",
      entityId: zone.id,
      after: zone,
    });
    return zone;
  }

  async updateZone(
    id: string,
    data: { code?: string; name?: string; description?: string },
    user?: RequestUser,
  ) {
    const zone = await this.prisma.exhibitionZone.findUniqueOrThrow({ where: { id }, include: { exhibition: true } });
    assertDataProfileAllowed(user, zone.exhibition.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: zone.exhibitionId, zoneId: id });
    const updated = await this.prisma.exhibitionZone.update({ where: { id }, data });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "exhibition_zone.update",
      entityType: "exhibition_zone",
      entityId: id,
      before: zone,
      after: updated,
    });
    return updated;
  }

  async createThresholdProfile(data: Prisma.ThresholdProfileCreateInput, user?: RequestUser) {
    const profile = await this.prisma.thresholdProfile.create({ data });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "threshold_profile.create",
      entityType: "threshold_profile",
      entityId: profile.id,
      after: profile,
    });
    return profile;
  }

  thresholdProfiles() {
    return this.prisma.thresholdProfile.findMany({ orderBy: { name: "asc" } });
  }

  async assignThreshold(data: Prisma.ThresholdAssignmentCreateInput, user?: RequestUser) {
    await this.assertThresholdAssignmentScope(data, user);
    const assignment = await this.prisma.thresholdAssignment.create({ data });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "threshold_assignment.create",
      entityType: "threshold_assignment",
      entityId: assignment.id,
      after: assignment,
    });
    return assignment;
  }

  private async generateExhibitionCode(dataProfile: string) {
    const prefix = `EXH-${this.formatDate(new Date())}-`;
    const existing = await this.prisma.exhibition.findMany({
      where: { dataProfile, code: { startsWith: prefix } },
      select: { code: true },
    });
    const next = this.nextSequence(
      existing.map((item) => item.code),
      prefix,
    );
    return `${prefix}${String(next).padStart(3, "0")}`;
  }

  private async generateZoneCode(exhibitionId: string) {
    const prefix = "UNIT-";
    const existing = await this.prisma.exhibitionZone.findMany({
      where: { exhibitionId, code: { startsWith: prefix } },
      select: { code: true },
    });
    const next = this.nextSequence(
      existing.map((item) => item.code),
      prefix,
    );
    return `${prefix}${String(next).padStart(3, "0")}`;
  }

  private nextSequence(codes: string[], prefix: string) {
    const max = codes.reduce((current, code) => {
      const suffix = Number.parseInt(code.slice(prefix.length), 10);
      return Number.isFinite(suffix) ? Math.max(current, suffix) : current;
    }, 0);
    return max + 1;
  }

  private formatDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  private async assertThresholdAssignmentScope(data: Prisma.ThresholdAssignmentCreateInput, user?: RequestUser) {
    const exhibitionId = this.connectId(data.exhibition);
    const zoneId = this.connectId(data.zone);
    const deviceId = this.connectId(data.device);
    const scope = accessScopeFor(user);
    const hasScopedBoundary = Boolean(scope.dataProfiles?.length || scope.exhibitionIds.length || scope.zoneIds.length);
    if (!exhibitionId && !zoneId && !deviceId && hasScopedBoundary) {
      throw new ForbiddenException("Scoped users must target a permitted exhibition, zone, or device.");
    }
    if (exhibitionId) {
      const exhibition = await this.prisma.exhibition.findUniqueOrThrow({ where: { id: exhibitionId } });
      assertDataProfileAllowed(user, exhibition.dataProfile);
      assertScopedResourceIds(user, { exhibitionId });
    }
    if (zoneId) {
      const zone = await this.prisma.exhibitionZone.findUniqueOrThrow({ where: { id: zoneId }, include: { exhibition: true } });
      assertDataProfileAllowed(user, zone.exhibition.dataProfile);
      assertScopedResourceIds(user, { exhibitionId: zone.exhibitionId, zoneId });
    }
    if (deviceId) {
      const device = await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
      assertDataProfileAllowed(user, device.dataProfile);
      assertScopedResourceIds(user, { exhibitionId: device.exhibitionId, zoneId: device.zoneId });
    }
  }

  private connectId(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const connect = (value as { connect?: { id?: unknown } }).connect;
    return typeof connect?.id === "string" ? connect.id : null;
  }
}
