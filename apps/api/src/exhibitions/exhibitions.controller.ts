import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CurrentUser,
  type RequestUser,
} from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExhibitionsService } from "./exhibitions.service";

const exhibitionSchema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  status: z.string().default("planned"),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  owner: z.string().optional().nullable(),
  preservationGoal: z.string().optional().nullable(),
  dataProfile: z.enum(["DEMO", "REAL"]).optional(),
});

const zoneSchema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});

const thresholdProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  warningTemperatureMin: z.number().optional().nullable(),
  warningTemperatureMax: z.number().optional().nullable(),
  criticalTemperatureMin: z.number().optional().nullable(),
  criticalTemperatureMax: z.number().optional().nullable(),
  warningHumidityMin: z.number().optional().nullable(),
  warningHumidityMax: z.number().optional().nullable(),
  criticalHumidityMin: z.number().optional().nullable(),
  criticalHumidityMax: z.number().optional().nullable(),
  triggerDurationMinutes: z.number().int().min(0).default(10),
  recoveryDurationMinutes: z.number().int().min(0).default(10),
  hysteresis: z.number().min(0).default(1),
  repeatIntervalMinutes: z.number().int().min(1).default(60),
});

const assignThresholdSchema = z.object({
  profileId: z.string().uuid(),
  exhibitionId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  priority: z.number().int().default(100),
});

@ApiTags("exhibitions")
@Controller("exhibitions")
@RequirePermissions("exhibitions:read")
export class ExhibitionsController {
  constructor(
    @Inject(ExhibitionsService)
    private readonly exhibitionsService: ExhibitionsService,
  ) {}

  @Get()
  list(
    @Query()
    query: {
      search?: string;
      status?: string;
      dataProfile?: string;
      page?: string;
      pageSize?: string;
    },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }, user);
  }

  @Get("threshold-profiles")
  @RequirePermissions("thresholds:manage")
  thresholdProfiles() {
    return this.exhibitionsService.thresholdProfiles();
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user?: RequestUser) {
    return this.exhibitionsService.get(id, user);
  }

  @Post()
  @RequirePermissions("exhibitions:manage")
  create(
    @Body(new ZodValidationPipe(exhibitionSchema))
    body: z.infer<typeof exhibitionSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.create(
      {
        code: body.code,
        name: body.name,
        status: body.status,
        startDate: body.startDate ?? undefined,
        endDate: body.endDate ?? undefined,
        owner: body.owner ?? undefined,
        preservationGoal: body.preservationGoal ?? undefined,
        dataProfile: body.dataProfile,
      },
      user,
    );
  }

  @Patch(":id")
  @RequirePermissions("exhibitions:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(exhibitionSchema.partial()))
    body: Partial<z.infer<typeof exhibitionSchema>>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.update(id, body, user);
  }

  @Post(":id/archive")
  @RequirePermissions("exhibitions:manage")
  archive(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.archive(id, body.reason, user);
  }

  @Post(":id/zones")
  @RequirePermissions("exhibitions:manage")
  createZone(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(zoneSchema)) body: z.infer<typeof zoneSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.createZone(id, body, user);
  }

  @Patch("zones/:zoneId")
  @RequirePermissions("exhibitions:manage")
  updateZone(
    @Param("zoneId") zoneId: string,
    @Body(new ZodValidationPipe(zoneSchema.partial()))
    body: Partial<z.infer<typeof zoneSchema>>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.updateZone(zoneId, body, user);
  }

  @Post("threshold-profiles")
  @RequirePermissions("thresholds:manage")
  createThresholdProfile(
    @Body(new ZodValidationPipe(thresholdProfileSchema))
    body: z.infer<typeof thresholdProfileSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.createThresholdProfile(body, user);
  }

  @Post("threshold-assignments")
  @RequirePermissions("thresholds:manage")
  assignThreshold(
    @Body(new ZodValidationPipe(assignThresholdSchema))
    body: z.infer<typeof assignThresholdSchema>,
    @CurrentUser() user?: RequestUser,
  ) {
    return this.exhibitionsService.assignThreshold({
      priority: body.priority,
      profile: { connect: { id: body.profileId } },
      exhibition: body.exhibitionId
        ? { connect: { id: body.exhibitionId } }
        : undefined,
      zone: body.zoneId ? { connect: { id: body.zoneId } } : undefined,
      device: body.deviceId ? { connect: { id: body.deviceId } } : undefined,
    }, user);
  }
}
