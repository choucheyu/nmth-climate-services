import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/public.decorator";
import { HealthService, type HealthStatus } from "./health.service";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Public()
  @Get("health")
  health(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
