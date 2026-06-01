import { Body, Controller, Get, Header, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DevicesService } from "./devices.service";

const createDeviceSchema = z.object({
  deviceName: z.string().min(1),
  displayName: z.string().min(1),
  ipAddress: z.string().trim().max(64).optional().nullable(),
  macAddress: z.string().trim().max(64).optional().nullable(),
  exhibitionId: z.string().uuid().optional().nullable(),
  zoneId: z.string().uuid().optional().nullable(),
  groupId: z.string().uuid().optional().nullable(),
  pointType: z.string().default("ambient"),
  enabled: z.boolean().default(true),
  dataProfile: z.enum(["DEMO", "REAL"]).optional()
});

const updateDeviceSchema = createDeviceSchema.partial();

const replaceSchema = z.object({
  newDeviceName: z.string().min(1),
  reason: z.string().min(3)
});

const calibrationSchema = z.object({
  calibratedAt: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  certificateUrl: z.string().url().optional(),
  note: z.string().optional()
});

const maintenanceSchema = z.object({
  type: z.string().min(1),
  performedAt: z.coerce.date(),
  performedBy: z.string().optional(),
  note: z.string().optional()
});

const thresholdSchema = z.object({
  name: z.string().min(1).optional(),
  warningTemperatureMin: z.number().nullable().optional(),
  warningTemperatureMax: z.number().nullable().optional(),
  warningHumidityMin: z.number().nullable().optional(),
  warningHumidityMax: z.number().nullable().optional(),
  triggerDurationMinutes: z.number().int().min(0).default(10),
  repeatIntervalMinutes: z.number().int().min(1).default(60),
  maxNotifications: z.number().int().min(1).max(100).default(3),
  unresolvedReminderMinutes: z.number().int().min(1).default(1440)
});

@ApiTags("devices")
@Controller("devices")
@RequirePermissions("devices:read")
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devicesService: DevicesService) {}

  @Get()
  list(
    @Query() query: { search?: string; exhibitionId?: string; zoneId?: string; status?: string; dataProfile?: string; page?: string; pageSize?: string },
    @CurrentUser() user?: RequestUser
  ) {
    return this.devicesService.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined
    }, user);
  }

  @Get("export")
  @RequirePermissions("reports:export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=\"nmth-devices.csv\"")
  export(@Query() query: { search?: string; exhibitionId?: string; status?: string; dataProfile?: string }, @CurrentUser() user?: RequestUser) {
    return this.devicesService.exportCsv(query, user);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user?: RequestUser) {
    return this.devicesService.get(id, user);
  }

  @Post()
  @RequirePermissions("devices:manage")
  create(
    @Body(new ZodValidationPipe(createDeviceSchema)) body: z.infer<typeof createDeviceSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.devicesService.create(
      {
        deviceName: body.deviceName,
        displayName: body.displayName,
        ipAddress: body.ipAddress ?? undefined,
        macAddress: body.macAddress ?? undefined,
        pointType: body.pointType,
        enabled: body.enabled,
        dataProfile: body.dataProfile,
        exhibition: body.exhibitionId ? { connect: { id: body.exhibitionId } } : undefined,
        zone: body.zoneId ? { connect: { id: body.zoneId } } : undefined,
        group: body.groupId ? { connect: { id: body.groupId } } : undefined
      },
      user
    );
  }

  @Patch(":id")
  @RequirePermissions("devices:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDeviceSchema)) body: z.infer<typeof updateDeviceSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.devicesService.update(
      id,
      {
        displayName: body.displayName,
        ipAddress: body.ipAddress,
        macAddress: body.macAddress,
        pointType: body.pointType,
        enabled: body.enabled,
        exhibition: body.exhibitionId === null ? { disconnect: true } : body.exhibitionId ? { connect: { id: body.exhibitionId } } : undefined,
        zone: body.zoneId === null ? { disconnect: true } : body.zoneId ? { connect: { id: body.zoneId } } : undefined,
        group: body.groupId === null ? { disconnect: true } : body.groupId ? { connect: { id: body.groupId } } : undefined
      },
      user
    );
  }

  @Post(":id/archive")
  @RequirePermissions("devices:manage")
  archive(@Param("id") id: string, @Body() body: { reason?: string }, @CurrentUser() user?: RequestUser) {
    return this.devicesService.archive(id, user, body.reason);
  }

  @Post(":id/unarchive")
  @RequirePermissions("devices:manage")
  unarchive(@Param("id") id: string, @Body() body: { reason?: string }, @CurrentUser() user?: RequestUser) {
    return this.devicesService.unarchive(id, user, body.reason);
  }

  @Post(":id/replace")
  @RequirePermissions("devices:manage")
  replace(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceSchema)) body: z.infer<typeof replaceSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.devicesService.replace({
      oldDeviceId: id,
      newDeviceName: body.newDeviceName,
      reason: body.reason,
      user
    });
  }

  @Post(":id/calibrations")
  @RequirePermissions("devices:manage")
  addCalibration(@Param("id") id: string, @Body(new ZodValidationPipe(calibrationSchema)) body: z.infer<typeof calibrationSchema>, @CurrentUser() user?: RequestUser) {
    return this.devicesService.addCalibration(id, body, user);
  }

  @Post(":id/maintenance")
  @RequirePermissions("devices:manage")
  addMaintenance(@Param("id") id: string, @Body(new ZodValidationPipe(maintenanceSchema)) body: z.infer<typeof maintenanceSchema>, @CurrentUser() user?: RequestUser) {
    return this.devicesService.addMaintenance(id, body, user);
  }

  @Post(":id/threshold")
  @RequirePermissions("thresholds:manage")
  upsertThreshold(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(thresholdSchema)) body: z.infer<typeof thresholdSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.devicesService.upsertThreshold(id, body, user);
  }
}
