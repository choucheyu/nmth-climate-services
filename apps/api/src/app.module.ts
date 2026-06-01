import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AiModule } from "./ai/ai.module";
import { AlertsModule } from "./alerts/alerts.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { SessionAuthGuard } from "./common/auth.guard";
import { PermissionsGuard } from "./common/permissions.guard";
import { CompensationModule } from "./compensation/compensation.module";
import { DevicesModule } from "./devices/devices.module";
import { ExhibitionsModule } from "./exhibitions/exhibitions.module";
import { FloorPlansModule } from "./floor-plans/floor-plans.module";
import { HealthModule } from "./health/health.module";
import { IngestModule } from "./ingest/ingest.module";
import { MeasurementsModule } from "./measurements/measurements.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReportsModule } from "./reports/reports.module";
import { SyntheticModule } from "./synthetic/synthetic.module";
import { SystemModule } from "./system/system.module";
import { WeatherModule } from "./weather/weather.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL") ?? "redis://localhost:6379"
        }
      })
    }),
    BullModule.registerQueue(
      { name: "notifications" },
      { name: "scheduled-reports" },
      { name: "weather-sync" },
      { name: "ai-monthly-reports" },
      { name: "data-compensation" }
    ),
    PrismaModule,
    AuthModule,
    HealthModule,
    IngestModule,
    DevicesModule,
    ExhibitionsModule,
    FloorPlansModule,
    MeasurementsModule,
    AlertsModule,
    ReportsModule,
    NotificationsModule,
    WeatherModule,
    AiModule,
    AuditModule,
    CompensationModule,
    SyntheticModule,
    SystemModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard }
  ]
})
export class AppModule {}
