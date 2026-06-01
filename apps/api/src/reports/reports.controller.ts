import { Body, Controller, Get, Header, Inject, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { reportExportRequestSchema, reportQuerySchema } from "@nmth/shared";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ReportsService } from "./reports.service";

const scheduleSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(3),
  recipients: z.array(z.unknown()).default([]),
  parameters: z.record(z.unknown()).default({}),
  locale: z.string().default("zh-TW")
});

@ApiTags("reports")
@Controller("reports")
@RequirePermissions("reports:read")
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reportsService: ReportsService) {}

  @Get("export")
  @RequirePermissions("reports:export")
  @Header("Cache-Control", "no-store")
  async export(@Query(new ZodValidationPipe(reportQuerySchema)) query: unknown, @Res() response: Response, @CurrentUser() user?: RequestUser) {
    const result = await this.reportsService.export(query, user);
    response.setHeader("Content-Type", result.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.send(result.body);
  }

  @Post("export")
  @RequirePermissions("reports:export")
  @Header("Cache-Control", "no-store")
  async exportPost(
    @Body(new ZodValidationPipe(reportExportRequestSchema)) body: unknown,
    @Res() response: Response,
    @CurrentUser() user?: RequestUser
  ) {
    const result = await this.reportsService.export(body, user);
    response.setHeader("Content-Type", result.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.send(result.body);
  }

  @Post("scheduled")
  @RequirePermissions("reports:export")
  scheduled(@Body(new ZodValidationPipe(scheduleSchema)) body: z.infer<typeof scheduleSchema>, @CurrentUser() user?: RequestUser) {
    return this.reportsService.createScheduledReport(body, user);
  }
}
