import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AlertsService } from "./alerts.service";

const ackSchema = z.object({
  note: z.string().max(2000).optional()
});

const silenceSchema = z.object({
  durationMinutes: z.number().int().positive().max(525600).default(60),
  reason: z.string().min(3).max(2000)
});

@ApiTags("alerts")
@Controller("alerts")
@RequirePermissions("alerts:read")
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly alertsService: AlertsService) {}

  @Get()
  list(
    @Query()
    query: {
      status?: string;
      level?: string;
      type?: string;
      deviceId?: string;
      exhibitionId?: string;
      zoneId?: string;
      dataProfile?: string;
      page?: string;
      pageSize?: string;
    },
    @CurrentUser() user?: RequestUser
  ) {
    return this.alertsService.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined
    }, user);
  }

  @Post(":id/silence")
  @RequirePermissions("alerts:ack")
  silence(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(silenceSchema)) body: z.infer<typeof silenceSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.alertsService.silenceAlert({ alertId: id, user, reason: body.reason, durationMinutes: body.durationMinutes });
  }

  @Post(":id/acknowledge")
  @RequirePermissions("alerts:ack")
  acknowledge(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ackSchema)) body: z.infer<typeof ackSchema>,
    @CurrentUser() user?: RequestUser
  ) {
    return this.alertsService.acknowledge({ alertId: id, user, note: body.note });
  }

  @Post("detect-offline")
  @RequirePermissions("devices:manage")
  detectOffline(@Body() body: { cutoffMinutes?: number; dataProfile?: string }, @CurrentUser() user?: RequestUser) {
    return this.alertsService.detectOffline(body.cutoffMinutes, body.dataProfile, user);
  }
}
