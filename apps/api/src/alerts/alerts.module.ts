import { Module } from "@nestjs/common";
import { AlertsOfflineScheduler } from "./alerts-offline.scheduler";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertsOfflineScheduler],
  exports: [AlertsService]
})
export class AlertsModule {}
