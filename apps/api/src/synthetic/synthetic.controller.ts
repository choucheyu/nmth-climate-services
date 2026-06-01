import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SyntheticService } from "./synthetic.service";

const syntheticSchema = z.object({
  deviceId: z.string().uuid(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  reason: z.string().min(6),
  confirmationText: z.string().min(6),
  approachFactor: z.number().min(0).max(1).default(0.65)
});

@ApiTags("synthetic")
@Controller("synthetic")
@RequirePermissions("synthetic:manage")
export class SyntheticController {
  constructor(@Inject(SyntheticService) private readonly syntheticService: SyntheticService) {}

  @Post("target-approach")
  generate(@Body(new ZodValidationPipe(syntheticSchema)) body: z.infer<typeof syntheticSchema>, @CurrentUser() user?: RequestUser) {
    return this.syntheticService.generateTargetApproach({
      ...body,
      operatorUser: user
    });
  }
}
