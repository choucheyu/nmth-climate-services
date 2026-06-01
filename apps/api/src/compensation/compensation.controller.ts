import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CompensationService } from "./compensation.service";

const detectSchema = z.object({
  deviceId: z.string().uuid().optional(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  expectedIntervalSeconds: z.number().int().positive().default(60)
});

const generateSchema = z.object({
  deviceId: z.string().uuid(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  method: z.enum(["linear_interpolation", "previous_value", "manual"]),
  reason: z.string().min(6),
  confirmationText: z.string().min(6),
  manualTemperatureC: z.number().optional(),
  manualHumidityPercent: z.number().optional()
});

@ApiTags("compensation")
@Controller("compensation")
@RequirePermissions("compensation:manage")
export class CompensationController {
  constructor(@Inject(CompensationService) private readonly compensationService: CompensationService) {}

  @Post("detect-gaps")
  detectGaps(@Body(new ZodValidationPipe(detectSchema)) body: z.infer<typeof detectSchema>, @CurrentUser() user?: RequestUser) {
    return this.compensationService.detectGaps(body, user);
  }

  @Post("generate")
  generate(@Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>, @CurrentUser() user?: RequestUser) {
    return this.compensationService.generate({
      ...body,
      operatorUser: user
    });
  }
}
