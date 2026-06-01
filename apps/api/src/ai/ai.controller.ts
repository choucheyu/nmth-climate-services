import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AiService } from "./ai.service";

const monthlyReportSchema = z.object({
  exhibitionId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  locale: z.string().default("zh-TW")
});

@ApiTags("ai")
@Controller("ai")
@RequirePermissions("reports:export")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("monthly-report")
  generateMonthlyReport(@Body(new ZodValidationPipe(monthlyReportSchema)) body: z.infer<typeof monthlyReportSchema>, @CurrentUser() user?: RequestUser) {
    return this.aiService.generateMonthlyReport(body, user);
  }
}
