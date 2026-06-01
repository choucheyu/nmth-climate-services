import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AlertsService } from "./alerts.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_CUTOFF_MINUTES = 3;

@Injectable()
export class AlertsOfflineScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsOfflineScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly alertsService: AlertsService,
    private readonly config: ConfigService
  ) {}

  onModuleInit() {
    if (!this.enabled()) {
      return;
    }
    const intervalSeconds = this.positiveInteger("ALERTS_OFFLINE_DETECT_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS, 10, 86_400);
    this.timer = setInterval(() => void this.detect(), intervalSeconds * 1000);
    this.timer.unref?.();
    void this.detect();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async detect() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const cutoffMinutes = this.positiveInteger("ALERTS_OFFLINE_CUTOFF_MINUTES", DEFAULT_CUTOFF_MINUTES, 1, 10_080);
      const dataProfile = this.config.get<string>("ALERTS_OFFLINE_DATA_PROFILE");
      const offlineCount = await this.alertsService.detectOffline(cutoffMinutes, dataProfile);
      if (offlineCount > 0) {
        this.logger.log(`Offline detection found ${offlineCount} device(s) past ${cutoffMinutes} minute cutoff.`);
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
    }
  }

  private enabled(): boolean {
    const value = this.config.get<string>("ALERTS_OFFLINE_AUTO_DETECT_ENABLED");
    return value === undefined || !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
  }

  private positiveInteger(key: string, fallback: number, min: number, max: number): number {
    const parsed = Number(this.config.get<string>(key));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }
}
