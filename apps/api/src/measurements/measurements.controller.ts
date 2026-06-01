import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { reportQuerySchema } from "@nmth/shared";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MeasurementsService } from "./measurements.service";

@ApiTags("measurements")
@Controller("measurements")
@RequirePermissions("dashboard:read")
export class MeasurementsController {
  constructor(@Inject(MeasurementsService) private readonly measurementsService: MeasurementsService) {}

  @Get("overview")
  overview(@Query("exhibitionId") exhibitionId?: string, @Query("dataProfile") dataProfile?: "DEMO" | "REAL", @CurrentUser() user?: RequestUser) {
    return this.measurementsService.latestOverview(exhibitionId, dataProfile, user);
  }

  @Get("latest")
  latest(
    @Query() query: { exhibitionId?: string; dataProfile?: string; deviceId?: string; deviceIds?: string | string[] },
    @CurrentUser() user?: RequestUser,
  ) {
    return this.measurementsService.latestByDevice(query, user);
  }

  @Get("trend-24h")
  trend24h(@Query() query: { deviceId?: string; exhibitionId?: string; dataProfile?: string }, @CurrentUser() user?: RequestUser) {
    return this.measurementsService.trend24h(query, user);
  }

  @Get("report")
  @RequirePermissions("reports:read")
  report(@Query(new ZodValidationPipe(reportQuerySchema)) query: unknown, @CurrentUser() user?: RequestUser) {
    return this.measurementsService.reportRows(query, user);
  }
}
