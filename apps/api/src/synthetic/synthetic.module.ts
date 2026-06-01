import { Module } from "@nestjs/common";
import { SyntheticController } from "./synthetic.controller";
import { SyntheticService } from "./synthetic.service";

@Module({
  controllers: [SyntheticController],
  providers: [SyntheticService],
  exports: [SyntheticService]
})
export class SyntheticModule {}
