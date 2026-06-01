import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import { diskStorage } from "multer";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import {
  CurrentUser,
  type RequestUser,
} from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FloorPlansService } from "./floor-plans.service";
import {
  FLOOR_PLAN_PDF_UPLOAD_MAX_BYTES,
  FLOOR_PLAN_PDF_UPLOAD_MAX_FIELD_BYTES,
  floorPlanPdfFileFilter,
} from "./pdf-upload.security";

const createFloorPlanSchema = z.object({
  exhibitionId: z.string().uuid(),
  name: z.string().min(1),
});

const floorPlanVersionSettingsSchema = z
  .object({
    pageNumber: z.number().int().min(1).optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    renderScale: z.number().min(1).max(2).optional(),
  })
  .refine(
    (value) =>
      (value.width == null && value.height == null) ||
      (value.width != null && value.height != null),
    {
      message: "width and height must be provided together",
    },
  );

const pointSchema = z.object({
  id: z.string().uuid().optional(),
  floorPlanId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
  name: z.string().min(1),
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  deviceId: z.string().uuid().optional().nullable(),
  zoneId: z.string().uuid().optional().nullable(),
  thresholdProfileId: z.string().uuid().optional().nullable(),
  displayStyle: z.record(z.unknown()).optional(),
});

@ApiTags("floor-plans")
@Controller("floor-plans")
@RequirePermissions("floorplans:read")
export class FloorPlansController {
  constructor(private readonly floorPlansService: FloorPlansService) {}

  @Get()
  list(
    @Query("exhibitionId") exhibitionId?: string,
    @Query("dataProfile") dataProfile?: string,
    @Query("includeArchived") includeArchived?: string,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.list({
      exhibitionId,
      dataProfile,
      includeArchived: includeArchived === "true",
    }, user);
  }

  @Get("versions/:versionId/file")
  async getVersionFile(
    @Param("versionId") versionId: string,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser,
  ) {
    const file = await this.floorPlansService.resolveVersionPdfFile(versionId, user);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${file.filename.replace(/["\r\n]/g, "")}"`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    return response.sendFile(file.path);
  }

  @Get("versions/:versionId/rendered-image")
  async getVersionRenderedImage(
    @Param("versionId") versionId: string,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser,
  ) {
    const file = await this.floorPlansService.resolveVersionRenderedImageFile(versionId, user);
    response.setHeader("Content-Type", "image/png");
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${file.filename.replace(/["\r\n]/g, "")}"`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return response.sendFile(file.path);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user?: RequestUser) {
    return this.floorPlansService.get(id, user);
  }

  @Post()
  @RequirePermissions("floorplans:manage")
  create(
    @Body(new ZodValidationPipe(createFloorPlanSchema))
    body: z.infer<typeof createFloorPlanSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.create({ ...body, user });
  }

  @Post(":id/versions")
  @RequirePermissions("floorplans:manage")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        pageNumber: { type: "number" },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        files: 1,
        fileSize: FLOOR_PLAN_PDF_UPLOAD_MAX_BYTES,
        fields: 4,
        fieldSize: FLOOR_PLAN_PDF_UPLOAD_MAX_FIELD_BYTES,
      },
      fileFilter: floorPlanPdfFileFilter,
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const destination = "uploads/floor-plans";
          mkdirSync(destination, { recursive: true });
          cb(null, destination);
        },
        filename: (_req, file, cb) => {
          const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extname(file.originalname)}`;
          cb(null, safeName);
        },
      }),
    }),
  )
  addVersion(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      pageNumber?: string;
      width?: string;
      height?: string;
      renderScale?: string;
    },
    @CurrentUser() user?: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("PDF file is required");
    }
    const settings = this.parseMultipartVersionSettings(body);
    return this.floorPlansService.addVersion({
      floorPlanId: id,
      pdfOriginalPath: file.path,
      pageNumber: settings.pageNumber ?? 1,
      width: settings.width ?? undefined,
      height: settings.height ?? undefined,
      renderScale: settings.renderScale,
      user,
    });
  }

  @Patch(":id/versions/:versionId")
  @RequirePermissions("floorplans:manage")
  updateVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body(new ZodValidationPipe(floorPlanVersionSettingsSchema))
    body: z.infer<typeof floorPlanVersionSettingsSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.updateVersion(id, versionId, body, user);
  }

  @Post(":id/versions/:versionId/active")
  @RequirePermissions("floorplans:manage")
  setActiveVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.setActiveVersion({
      floorPlanId: id,
      versionId,
      user,
    });
  }

  @Post(":id/archive")
  @RequirePermissions("floorplans:manage")
  archiveFloorPlan(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.archiveFloorPlan({
      floorPlanId: id,
      reason: body.reason,
      user,
    });
  }

  @Post(":id/versions/:versionId/archive")
  @RequirePermissions("floorplans:manage")
  archiveVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body() body: { reason?: string },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.archiveVersion({
      floorPlanId: id,
      versionId,
      reason: body.reason,
      user,
    });
  }

  @Post("points")
  @RequirePermissions("floorplans:manage")
  upsertPoint(
    @Body(new ZodValidationPipe(pointSchema)) body: z.infer<typeof pointSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.upsertPoint({
      ...body,
      displayStyle: body.displayStyle as Prisma.InputJsonValue | undefined,
    }, user);
  }

  @Patch("points/:id")
  @RequirePermissions("floorplans:manage")
  updatePoint(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(pointSchema.partial()))
    body: Partial<z.infer<typeof pointSchema>>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.updatePoint(id, {
      name: body.name,
      xRatio: body.xRatio,
      yRatio: body.yRatio,
      displayStyle: body.displayStyle as Prisma.InputJsonValue | undefined,
      device:
        body.deviceId === null
          ? { disconnect: true }
          : body.deviceId
            ? { connect: { id: body.deviceId } }
            : undefined,
      zone:
        body.zoneId === null
          ? { disconnect: true }
          : body.zoneId
            ? { connect: { id: body.zoneId } }
            : undefined,
      thresholdProfile:
        body.thresholdProfileId === null
          ? { disconnect: true }
          : body.thresholdProfileId
            ? { connect: { id: body.thresholdProfileId } }
            : undefined,
    }, user);
  }

  @Post("points/:id/archive")
  @RequirePermissions("floorplans:manage")
  archivePoint(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.floorPlansService.archivePoint({
      pointId: id,
      reason: body.reason,
      user,
    });
  }

  private parseMultipartVersionSettings(body: {
    pageNumber?: string;
    width?: string;
    height?: string;
    renderScale?: string;
  }) {
    const pageNumber = this.parseOptionalNumber(
      body.pageNumber,
      "pageNumber",
      true,
    );
    const width = this.parseOptionalNumber(body.width, "width", true);
    const height = this.parseOptionalNumber(body.height, "height", true);
    const renderScale = this.parseOptionalNumber(
      body.renderScale,
      "renderScale",
      false,
    );
    const parsed = floorPlanVersionSettingsSchema.safeParse({
      pageNumber,
      width,
      height,
      renderScale,
    });
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    return parsed.data;
  }

  private parseOptionalNumber(
    value: string | undefined,
    field: string,
    integer: boolean,
  ) {
    if (value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
      throw new BadRequestException(
        `${field} must be a valid ${integer ? "integer" : "number"}`,
      );
    }
    return parsed;
  }
}
