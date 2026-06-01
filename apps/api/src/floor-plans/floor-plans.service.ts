import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type FloorPlanVersion } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { open, realpath, stat, unlink } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile, scopedIdFilter } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { loadLatestMeasurementsByDevice } from "../common/latest-measurements";
import { FloorPlanRendererService, type FloorPlanRenderResult } from "./floor-plan-renderer.service";
import { FLOOR_PLAN_PDF_UPLOAD_MAX_BYTES } from "./pdf-upload.security";

type FloorPlanVersionResponse = FloorPlanVersion & {
  fileUrl: string;
  pdfUrl: string;
  renderedImagePath: string | null;
  renderedImageUrl: string | null;
};

const FLOOR_PLAN_CURRENT_ALERT_STATUSES = ["active", "acknowledged"] as const;
const FLOOR_PLAN_CURRENT_ALERT_TYPES = [
  "humidity_threshold",
  "temperature_threshold",
  "device_offline",
] as const;
const FLOOR_PLAN_DEVICE_ALERT_SELECT = {
  id: true,
  type: true,
  level: true,
  status: true,
  triggeredAt: true,
  message: true,
  metadata: true,
} satisfies Prisma.AlertSelect;

@Injectable()
export class FloorPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: FloorPlanRendererService = new FloorPlanRendererService(),
  ) {}

  async list(
    input: {
      exhibitionId?: string;
      dataProfile?: string;
      includeArchived?: boolean;
    } = {},
    user?: RequestUser,
  ) {
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, input.dataProfile);
    const archivedFilter = input.includeArchived ? undefined : null;
    const floorPlans = await this.prisma.floorPlan.findMany({
      where: {
        dataProfile,
        exhibitionId: scopedIdFilter(user, "exhibitionId", input.exhibitionId),
        archivedAt: archivedFilter,
      },
      include: {
        exhibition: true,
        versions: {
          where: { archivedAt: archivedFilter },
          orderBy: { version: "desc" },
        },
        points: {
          where: { archivedAt: archivedFilter, zoneId: scopedIdFilter(user, "zoneId") },
          include: {
            device: {
              include: {
                alerts: this.currentDeviceAlertsQuery(dataProfile),
              },
            },
            zone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const enrichedFloorPlans = await this.attachLatestPointMeasurements(floorPlans, dataProfile);
    return enrichedFloorPlans.map((floorPlan) => this.toFloorPlanResponse(floorPlan));
  }

  async get(id: string, user?: RequestUser) {
    const dataProfile = await resolveScopedDataProfile(this.prisma, user);
    const floorPlan = await this.prisma.floorPlan.findFirstOrThrow({
      where: { id, dataProfile, exhibitionId: scopedIdFilter(user, "exhibitionId"), archivedAt: null },
      include: {
        exhibition: true,
        versions: { where: { archivedAt: null }, orderBy: { version: "desc" } },
        points: {
          where: { archivedAt: null, zoneId: scopedIdFilter(user, "zoneId") },
          include: {
            device: {
              include: {
                alerts: this.currentDeviceAlertsQuery(dataProfile),
              },
            },
            zone: true,
            thresholdProfile: true,
          },
        },
      },
    });
    const [enrichedFloorPlan] = await this.attachLatestPointMeasurements([floorPlan], dataProfile);
    return this.toFloorPlanResponse(enrichedFloorPlan ?? floorPlan);
  }

  async create(input: { exhibitionId: string; name: string; user?: RequestUser }) {
    const exhibition = await this.prisma.exhibition.findFirstOrThrow({
      where: { id: input.exhibitionId, archivedAt: null },
    });
    assertDataProfileAllowed(input.user, exhibition.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: input.exhibitionId });
    const floorPlan = await this.prisma.floorPlan.create({
      data: {
        dataProfile: exhibition.dataProfile,
        exhibitionId: input.exhibitionId,
        name: input.name,
      },
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan.create",
      entityType: "floor_plan",
      entityId: floorPlan.id,
      after: floorPlan,
    });
    return floorPlan;
  }

  async addVersion(input: {
    floorPlanId: string;
    pdfOriginalPath: string;
    pageNumber: number;
    width?: number;
    height?: number;
    renderScale?: number;
    user?: RequestUser;
  }) {
    const floorPlan = await this.prisma.floorPlan.findFirst({
      where: { id: input.floorPlanId, archivedAt: null },
    });
    if (!floorPlan) {
      throw new NotFoundException("Floor plan not found");
    }
    assertDataProfileAllowed(input.user, floorPlan.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: floorPlan.exhibitionId });
    try {
      await this.assertUploadedPdfFile(input.pdfOriginalPath);
    } catch (error) {
      await unlink(input.pdfOriginalPath).catch(() => undefined);
      throw error;
    }
    const latest = await this.prisma.floorPlanVersion.findFirst({
      where: { floorPlanId: input.floorPlanId },
      orderBy: { version: "desc" },
    });
    const versionId = randomUUID();
    let renderedImage: FloorPlanRenderResult;
    try {
      renderedImage = await this.renderVersionImage({
        id: versionId,
        pdfOriginalPath: input.pdfOriginalPath,
        pageNumber: input.pageNumber,
        renderScale: input.renderScale ?? 1,
      });
    } catch (error) {
      await unlink(input.pdfOriginalPath).catch(() => undefined);
      throw error;
    }
    const version = await this.prisma.floorPlanVersion.create({
      data: {
        id: versionId,
        floorPlanId: input.floorPlanId,
        version: (latest?.version ?? 0) + 1,
        pdfOriginalPath: input.pdfOriginalPath,
        renderedImagePath: renderedImage.renderedImagePath,
        pageNumber: input.pageNumber,
        width: input.width ?? renderedImage.width,
        height: input.height ?? renderedImage.height,
        renderScale: input.renderScale ?? 1,
        createdByUserId: input.user?.id,
      },
    });
    await this.prisma.floorPlan.update({
      where: { id: input.floorPlanId },
      data: { activeVersionId: version.id },
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan_version.create",
      entityType: "floor_plan_version",
      entityId: version.id,
      after: { version, activeVersionId: version.id },
    });
    return this.toVersionResponse(version);
  }

  async updateVersion(
    floorPlanId: string,
    versionId: string,
    input: {
      pageNumber?: number;
      width?: number | null;
      height?: number | null;
      renderScale?: number;
    },
    user?: RequestUser,
  ) {
    const existing = await this.prisma.floorPlanVersion.findFirst({
      where: {
        id: versionId,
        floorPlanId,
        archivedAt: null,
        floorPlan: { archivedAt: null },
      },
    });
    if (!existing) {
      throw new NotFoundException("Floor plan version not found");
    }
    const floorPlan = await this.prisma.floorPlan.findUniqueOrThrow({ where: { id: floorPlanId } });
    assertDataProfileAllowed(user, floorPlan.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: floorPlan.exhibitionId });
    const shouldRegenerateImage =
      input.pageNumber !== undefined ||
      input.renderScale !== undefined ||
      !existing.renderedImagePath;
    const renderedImage = shouldRegenerateImage
      ? await this.renderVersionImage({
          id: existing.id,
          pdfOriginalPath: existing.pdfOriginalPath,
          pageNumber: input.pageNumber ?? existing.pageNumber,
          renderScale: input.renderScale ?? existing.renderScale,
        })
      : null;
    const version = await this.prisma.floorPlanVersion.update({
      where: { id: versionId },
      data: {
        pageNumber: input.pageNumber,
        width: input.width !== undefined ? input.width : renderedImage?.width,
        height: input.height !== undefined ? input.height : renderedImage?.height,
        renderScale: input.renderScale,
        renderedImagePath: renderedImage?.renderedImagePath,
      },
    });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "floor_plan_version.update",
      entityType: "floor_plan_version",
      entityId: versionId,
      before: existing,
      after: version,
    });
    return this.toVersionResponse(version);
  }

  async setActiveVersion(input: {
    floorPlanId: string;
    versionId: string;
    user?: RequestUser;
  }) {
    const version = await this.prisma.floorPlanVersion.findFirst({
      where: {
        id: input.versionId,
        floorPlanId: input.floorPlanId,
        archivedAt: null,
        floorPlan: { archivedAt: null },
      },
    });
    if (!version) {
      throw new NotFoundException("Floor plan version not found");
    }
    const before = await this.prisma.floorPlan.findUniqueOrThrow({
      where: { id: input.floorPlanId },
    });
    assertDataProfileAllowed(input.user, before.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: before.exhibitionId });
    const floorPlan = await this.prisma.floorPlan.update({
      where: { id: input.floorPlanId },
      data: { activeVersionId: input.versionId },
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan.set_active_version",
      entityType: "floor_plan",
      entityId: input.floorPlanId,
      before: { activeVersionId: before.activeVersionId },
      after: { activeVersionId: input.versionId },
    });
    return this.toFloorPlanResponse({
      ...floorPlan,
      versions: await this.prisma.floorPlanVersion.findMany({
        where: { floorPlanId: input.floorPlanId, archivedAt: null },
        orderBy: { version: "desc" },
      }),
    });
  }

  async archiveFloorPlan(input: {
    floorPlanId: string;
    reason?: string;
    user?: RequestUser;
  }) {
    const before = await this.prisma.floorPlan.findFirstOrThrow({
      where: { id: input.floorPlanId, archivedAt: null },
      include: {
        versions: { where: { archivedAt: null } },
        points: { where: { archivedAt: null } },
      },
    });
    assertDataProfileAllowed(input.user, before.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: before.exhibitionId });
    const floorPlan = await this.prisma.floorPlan.update({
      where: { id: input.floorPlanId },
      data: { archivedAt: new Date(), activeVersionId: null },
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan.archive",
      entityType: "floor_plan",
      entityId: input.floorPlanId,
      riskLevel: "high",
      before,
      after: floorPlan,
      reason: input.reason,
    });
    return floorPlan;
  }

  async archiveVersion(input: {
    floorPlanId: string;
    versionId: string;
    reason?: string;
    user?: RequestUser;
  }) {
    const before = await this.prisma.floorPlanVersion.findFirst({
      where: {
        id: input.versionId,
        floorPlanId: input.floorPlanId,
        archivedAt: null,
        floorPlan: { archivedAt: null },
      },
      include: { floorPlan: true },
    });
    if (!before) {
      throw new NotFoundException("Floor plan version not found");
    }
    assertDataProfileAllowed(input.user, before.floorPlan.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: before.floorPlan.exhibitionId });

    const archivedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.floorPlanVersion.findMany({
        where: {
          floorPlanId: input.floorPlanId,
          id: { not: input.versionId },
          archivedAt: null,
        },
        orderBy: { version: "desc" },
      });
      const nextActiveVersionId =
        before.floorPlan.activeVersionId === input.versionId
          ? (candidates[0]?.id ?? null)
          : before.floorPlan.activeVersionId;
      const version = await tx.floorPlanVersion.update({
        where: { id: input.versionId },
        data: { archivedAt },
      });
      const floorPlan =
        nextActiveVersionId !== before.floorPlan.activeVersionId
          ? await tx.floorPlan.update({
              where: { id: input.floorPlanId },
              data: { activeVersionId: nextActiveVersionId },
            })
          : before.floorPlan;
      return { version, floorPlan };
    });

    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan_version.archive",
      entityType: "floor_plan_version",
      entityId: input.versionId,
      riskLevel: "high",
      before,
      after: result,
      reason: input.reason,
    });
    return this.toVersionResponse(result.version);
  }

  async resolveVersionRenderedImageFile(versionId: string, user?: RequestUser) {
    const version = await this.prisma.floorPlanVersion.findUnique({
      where: { id: versionId },
      include: { floorPlan: true },
    });
    if (!version) {
      throw new NotFoundException("Floor plan version not found");
    }
    assertDataProfileAllowed(user, version.floorPlan.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: version.floorPlan.exhibitionId });
    if (!version.renderedImagePath) {
      throw new NotFoundException("Floor plan rendered image not found");
    }

    const renderedRoot = this.renderer.renderedRoot();
    const storedPath = isAbsolute(version.renderedImagePath)
      ? resolve(version.renderedImagePath)
      : resolve(process.cwd(), version.renderedImagePath);
    if (!this.isPathInside(renderedRoot, storedPath)) {
      throw new BadRequestException("Floor plan rendered image path is outside the allowed directory");
    }
    if (extname(storedPath).toLowerCase() !== ".png") {
      throw new BadRequestException("Floor plan rendered image is not a PNG");
    }

    let renderedRootReal: string;
    let fileRealPath: string;
    try {
      [renderedRootReal, fileRealPath] = await Promise.all([
        realpath(renderedRoot),
        realpath(storedPath),
      ]);
    } catch {
      throw new NotFoundException("Floor plan rendered image file not found");
    }
    if (!this.isPathInside(renderedRootReal, fileRealPath)) {
      throw new BadRequestException("Floor plan rendered image path is outside the allowed directory");
    }
    const fileStat = await stat(fileRealPath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new NotFoundException("Floor plan rendered image file not found");
    }
    return { path: fileRealPath, filename: basename(fileRealPath) };
  }

  async backfillRenderedImages(input: {
    write?: boolean;
    includeArchived?: boolean;
    repairMissing?: boolean;
    limit?: number;
    versionId?: string;
  } = {}) {
    const versions = await this.prisma.floorPlanVersion.findMany({
      where: {
        id: input.versionId,
        archivedAt: input.includeArchived ? undefined : null,
        renderedImagePath: input.repairMissing ? undefined : null,
      },
      orderBy: { createdAt: "asc" },
      take: input.limit,
    });
    const summary = {
      scanned: versions.length,
      planned: 0,
      rendered: 0,
      skipped: 0,
      failed: 0,
      dryRun: !input.write,
      results: [] as Array<{
        versionId: string;
        status: "planned" | "rendered" | "skipped" | "failed";
        reason?: string;
        renderedImagePath?: string;
      }>,
    };

    for (const version of versions) {
      if (input.repairMissing && version.renderedImagePath) {
        const exists = await this.renderedImageExists(version.renderedImagePath);
        if (exists) {
          summary.skipped += 1;
          summary.results.push({ versionId: version.id, status: "skipped", reason: "rendered image already exists" });
          continue;
        }
      }
      if (!input.write) {
        summary.planned += 1;
        summary.results.push({ versionId: version.id, status: "planned" });
        continue;
      }
      try {
        const renderedImage = await this.renderVersionImage(version);
        await this.prisma.floorPlanVersion.update({
          where: { id: version.id },
          data: {
            renderedImagePath: renderedImage.renderedImagePath,
            width: renderedImage.width,
            height: renderedImage.height,
          },
        });
        summary.rendered += 1;
        summary.results.push({
          versionId: version.id,
          status: "rendered",
          renderedImagePath: renderedImage.renderedImagePath,
        });
      } catch (error) {
        summary.failed += 1;
        summary.results.push({
          versionId: version.id,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  }

  async resolveVersionPdfFile(versionId: string, user?: RequestUser) {
    const version = await this.prisma.floorPlanVersion.findUnique({
      where: { id: versionId },
      include: { floorPlan: true },
    });
    if (!version) {
      throw new NotFoundException("Floor plan version not found");
    }
    assertDataProfileAllowed(user, version.floorPlan.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: version.floorPlan.exhibitionId });

    const uploadRoot = this.uploadRoot();
    const storedPath = isAbsolute(version.pdfOriginalPath)
      ? resolve(version.pdfOriginalPath)
      : resolve(process.cwd(), version.pdfOriginalPath);
    if (!this.isPathInside(uploadRoot, storedPath)) {
      throw new BadRequestException(
        "Floor plan PDF path is outside the allowed upload directory",
      );
    }
    if (extname(storedPath).toLowerCase() !== ".pdf") {
      throw new BadRequestException("Floor plan version is not a PDF");
    }

    let uploadRootReal: string;
    let fileRealPath: string;
    try {
      [uploadRootReal, fileRealPath] = await Promise.all([
        realpath(uploadRoot),
        realpath(storedPath),
      ]);
    } catch {
      throw new NotFoundException("Floor plan PDF file not found");
    }

    if (!this.isPathInside(uploadRootReal, fileRealPath)) {
      throw new BadRequestException(
        "Floor plan PDF path is outside the allowed upload directory",
      );
    }

    const fileStat = await stat(fileRealPath).catch(() => null);
    if (!fileStat) {
      throw new NotFoundException("Floor plan PDF file not found");
    }
    if (!fileStat.isFile()) {
      throw new NotFoundException("Floor plan PDF file not found");
    }

    const handle = await open(fileRealPath, "r").catch(() => null);
    if (!handle) {
      throw new NotFoundException("Floor plan PDF file not found");
    }
    try {
      const header = Buffer.alloc(5);
      const result = await handle.read(header, 0, header.length, 0);
      if (
        result.bytesRead !== header.length ||
        header.toString("utf8") !== "%PDF-"
      ) {
        throw new BadRequestException("Floor plan file is not a valid PDF");
      }
    } finally {
      await handle.close();
    }

    return { path: fileRealPath, filename: basename(fileRealPath) };
  }

  async upsertPoint(input: {
    id?: string;
    floorPlanId: string;
    versionId?: string;
    name: string;
    xRatio: number;
    yRatio: number;
    deviceId?: string | null;
    zoneId?: string | null;
    thresholdProfileId?: string | null;
    displayStyle?: Prisma.InputJsonValue;
  }, user?: RequestUser) {
    const floorPlan = await this.ensurePointTargetIsEditable(input.floorPlanId, input.versionId, user);
    await this.assertPointConnectionsAreScoped(floorPlan, { zoneId: input.zoneId, deviceId: input.deviceId }, user);
    const data = {
      floorPlanId: input.floorPlanId,
      versionId: input.versionId,
      name: input.name,
      xRatio: input.xRatio,
      yRatio: input.yRatio,
      deviceId: input.deviceId ?? undefined,
      zoneId: input.zoneId ?? undefined,
      thresholdProfileId: input.thresholdProfileId ?? undefined,
      displayStyle: input.displayStyle ?? {},
    };
    if (input.id) {
      const before = await this.prisma.floorPlanPoint.findFirstOrThrow({
        where: {
          id: input.id,
          archivedAt: null,
          floorPlan: { id: floorPlan.id, archivedAt: null },
        },
        include: { floorPlan: true, version: true, device: true, zone: true },
      });
      const point = await this.prisma.floorPlanPoint.update({
        where: { id: input.id },
        data,
      });
      await writeAuditLog(this.prisma, {
        userId: user?.id,
        action: "floor_plan_point.update",
        entityType: "floor_plan_point",
        entityId: input.id,
        before,
        after: point,
      });
      return point;
    }
    const point = await this.prisma.floorPlanPoint.create({ data });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "floor_plan_point.create",
      entityType: "floor_plan_point",
      entityId: point.id,
      after: point,
    });
    return point;
  }

  async updatePoint(id: string, input: Prisma.FloorPlanPointUpdateInput, user?: RequestUser) {
    const existing = await this.prisma.floorPlanPoint.findFirstOrThrow({
      where: { id, archivedAt: null, floorPlan: { archivedAt: null } },
      include: { floorPlan: true, version: true, device: true, zone: true },
    });
    assertDataProfileAllowed(user, existing.floorPlan.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: existing.floorPlan.exhibitionId, zoneId: existing.zoneId });
    await this.assertPointConnectionsAreScoped(
      existing.floorPlan,
      { zoneId: this.connectId(input.zone), deviceId: this.connectId(input.device) },
      user,
    );
    const point = await this.prisma.floorPlanPoint.update({ where: { id }, data: input });
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "floor_plan_point.update",
      entityType: "floor_plan_point",
      entityId: id,
      before: existing,
      after: point,
    });
    return point;
  }

  async archivePoint(input: {
    pointId: string;
    reason?: string;
    user?: RequestUser;
  }) {
    const before = await this.prisma.floorPlanPoint.findFirst({
      where: {
        id: input.pointId,
        archivedAt: null,
        floorPlan: { archivedAt: null },
      },
      include: { floorPlan: true, version: true, device: true, zone: true },
    });
    if (!before) {
      throw new NotFoundException("Floor plan point not found");
    }
    assertDataProfileAllowed(input.user, before.floorPlan.dataProfile);
    assertScopedResourceIds(input.user, { exhibitionId: before.floorPlan.exhibitionId, zoneId: before.zoneId });
    const point = await this.prisma.floorPlanPoint.update({
      where: { id: input.pointId },
      data: { archivedAt: new Date() },
    });
    await writeAuditLog(this.prisma, {
      userId: input.user?.id,
      action: "floor_plan_point.archive",
      entityType: "floor_plan_point",
      entityId: input.pointId,
      riskLevel: "high",
      before,
      after: point,
      reason: input.reason,
    });
    return point;
  }

  private toFloorPlanResponse<
    T extends { activeVersionId: string | null; versions: FloorPlanVersion[] },
  >(floorPlan: T) {
    const versions = floorPlan.versions.map((version) =>
      this.toVersionResponse(version),
    );
    const activeVersion =
      versions.find((version) => version.id === floorPlan.activeVersionId) ??
      versions[0] ??
      null;
    return { ...floorPlan, versions, activeVersion };
  }

  private toVersionResponse(
    version: FloorPlanVersion,
  ): FloorPlanVersionResponse {
    const fileUrl = `/api/floor-plans/versions/${version.id}/file`;
    const renderedImageUrl = version.renderedImagePath
      ? `/api/floor-plans/versions/${version.id}/rendered-image`
      : null;
    return {
      ...version,
      pdfOriginalPath: this.publicOriginalPath(version.pdfOriginalPath),
      renderedImagePath: version.renderedImagePath ? this.publicRenderedPath(version.renderedImagePath) : null,
      renderedImageUrl,
      fileUrl,
      pdfUrl: fileUrl,
    };
  }

  private async attachLatestPointMeasurements<
    T extends {
      points?: Array<
        {
          device?: ({ id: string } & Record<string, unknown>) | null;
        } & Record<string, unknown>
      >;
    } & Record<string, unknown>,
  >(floorPlans: T[], dataProfile: string): Promise<T[]> {
    const deviceIds = floorPlans
      .flatMap((floorPlan) => floorPlan.points ?? [])
      .map((point) => point.device?.id)
      .filter((id): id is string => Boolean(id));
    const latestMeasurements = await loadLatestMeasurementsByDevice(this.prisma, dataProfile, deviceIds);
    return floorPlans.map(
      (floorPlan) =>
        ({
          ...floorPlan,
          points: (floorPlan.points ?? []).map((point) => {
            if (!point.device) {
              return point;
            }
            const latestMeasurement = latestMeasurements.get(point.device.id) ?? null;
            return {
              ...point,
              device: {
                ...point.device,
                latestMeasurement,
                measurements: latestMeasurement ? [latestMeasurement] : [],
              },
            };
          }),
        }) as T,
    );
  }

  private currentDeviceAlertsQuery(dataProfile: string) {
    return {
      where: {
        dataProfile,
        status: { in: [...FLOOR_PLAN_CURRENT_ALERT_STATUSES] },
        type: { in: [...FLOOR_PLAN_CURRENT_ALERT_TYPES] },
      },
      select: FLOOR_PLAN_DEVICE_ALERT_SELECT,
      orderBy: { triggeredAt: "desc" as const },
    };
  }

  private publicOriginalPath(pdfOriginalPath: string) {
    if (!isAbsolute(pdfOriginalPath)) {
      return pdfOriginalPath;
    }

    const uploadRoot = this.uploadRoot();
    const relativePath = relative(uploadRoot, resolve(pdfOriginalPath));
    if (
      relativePath &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    ) {
      return ["uploads", "floor-plans", ...relativePath.split(sep)].join("/");
    }
    return basename(pdfOriginalPath);
  }

  private publicRenderedPath(renderedImagePath: string) {
    if (!isAbsolute(renderedImagePath)) {
      return renderedImagePath;
    }
    const renderedRoot = this.renderer.renderedRoot();
    const relativePath = relative(renderedRoot, resolve(renderedImagePath));
    if (
      relativePath &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    ) {
      return ["uploads", "floor-plans", "rendered", ...relativePath.split(sep)].join("/");
    }
    return basename(renderedImagePath);
  }

  private uploadRoot() {
    return resolve(process.cwd(), "uploads/floor-plans");
  }

  private async renderVersionImage(version: {
    id: string;
    pdfOriginalPath: string;
    pageNumber: number;
    renderScale?: number | null;
  }) {
    await this.assertUploadedPdfFile(version.pdfOriginalPath);
    const pdfPath = isAbsolute(version.pdfOriginalPath)
      ? resolve(version.pdfOriginalPath)
      : resolve(process.cwd(), version.pdfOriginalPath);
    return this.renderer.renderPdfPage({
      versionId: version.id,
      pdfPath,
      pageNumber: version.pageNumber,
      renderScale: version.renderScale,
    });
  }

  private async renderedImageExists(renderedImagePath: string) {
    const renderedRoot = this.renderer.renderedRoot();
    const resolved = isAbsolute(renderedImagePath)
      ? resolve(renderedImagePath)
      : resolve(process.cwd(), renderedImagePath);
    if (!this.isPathInside(renderedRoot, resolved)) {
      return false;
    }
    const fileStat = await stat(resolved).catch(() => null);
    return Boolean(fileStat?.isFile());
  }

  private async assertUploadedPdfFile(pdfPath: string): Promise<void> {
    const resolved = isAbsolute(pdfPath)
      ? resolve(pdfPath)
      : resolve(process.cwd(), pdfPath);
    if (!this.isPathInside(this.uploadRoot(), resolved)) {
      throw new BadRequestException("Floor plan PDF path is outside the allowed upload directory");
    }
    if (extname(resolved).toLowerCase() !== ".pdf") {
      throw new BadRequestException("Floor plan upload must use a .pdf file");
    }
    const fileStat = await stat(resolved).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new BadRequestException("Floor plan upload is not a file");
    }
    if (fileStat.size <= 0 || fileStat.size > FLOOR_PLAN_PDF_UPLOAD_MAX_BYTES) {
      throw new BadRequestException("Floor plan PDF file size is not allowed");
    }
    const handle = await open(resolved, "r");
    try {
      const header = Buffer.alloc(5);
      const result = await handle.read(header, 0, header.length, 0);
      if (result.bytesRead !== header.length || header.toString("utf8") !== "%PDF-") {
        throw new BadRequestException("Floor plan file is not a valid PDF");
      }
    } finally {
      await handle.close();
    }
  }

  private isPathInside(parent: string, child: string) {
    const relativePath = relative(parent, child);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  }

  private async ensurePointTargetIsEditable(
    floorPlanId: string,
    versionId?: string,
    user?: RequestUser,
  ) {
    const floorPlan = await this.prisma.floorPlan.findFirst({
      where: { id: floorPlanId, archivedAt: null },
    });
    if (!floorPlan) {
      throw new NotFoundException("Floor plan not found");
    }
    assertDataProfileAllowed(user, floorPlan.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: floorPlan.exhibitionId });
    if (!versionId) {
      return floorPlan;
    }
    const version = await this.prisma.floorPlanVersion.findFirst({
      where: { id: versionId, floorPlanId, archivedAt: null },
    });
    if (!version) {
      throw new NotFoundException("Floor plan version not found");
    }
    return floorPlan;
  }

  private async assertPointConnectionsAreScoped(
    floorPlan: { id: string; dataProfile: string; exhibitionId: string },
    input: { zoneId?: string | null; deviceId?: string | null },
    user?: RequestUser,
  ) {
    if (input.zoneId) {
      const zone = await this.prisma.exhibitionZone.findUniqueOrThrow({ where: { id: input.zoneId }, include: { exhibition: true } });
      if (zone.exhibitionId !== floorPlan.exhibitionId) {
        throw new BadRequestException("Point zone must belong to the floor plan exhibition");
      }
      assertDataProfileAllowed(user, zone.exhibition.dataProfile);
      assertScopedResourceIds(user, { exhibitionId: zone.exhibitionId, zoneId: zone.id });
    }
    if (input.deviceId) {
      const device = await this.prisma.device.findUniqueOrThrow({ where: { id: input.deviceId } });
      if (device.exhibitionId !== floorPlan.exhibitionId) {
        throw new BadRequestException("Point device must belong to the floor plan exhibition");
      }
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
