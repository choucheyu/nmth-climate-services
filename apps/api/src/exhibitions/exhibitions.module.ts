import { Module } from "@nestjs/common";
import { ExhibitionsController } from "./exhibitions.controller";
import { ExhibitionsService } from "./exhibitions.service";

@Module({
  controllers: [ExhibitionsController],
  providers: [ExhibitionsService],
  exports: [ExhibitionsService]
})
export class ExhibitionsModule {}
