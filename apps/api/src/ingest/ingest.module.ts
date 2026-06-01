import { Module } from "@nestjs/common";
import { AlertsModule } from "../alerts/alerts.module";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

@Module({
  imports: [AlertsModule],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService]
})
export class IngestModule {}
