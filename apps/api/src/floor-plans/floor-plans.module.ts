import { Module } from "@nestjs/common";
import { FloorPlansController } from "./floor-plans.controller";
import { FloorPlanRendererService } from "./floor-plan-renderer.service";
import { FloorPlansService } from "./floor-plans.service";

@Module({
  controllers: [FloorPlansController],
  providers: [FloorPlanRendererService, FloorPlansService],
  exports: [FloorPlansService]
})
export class FloorPlansModule {}
