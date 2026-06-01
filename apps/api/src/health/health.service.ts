import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";

export interface HealthStatus {
  status: "ok" | "degraded";
  version: string;
  buildTime: string;
  checks: Record<string, { status: "ok" | "fail"; detail?: string }>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async check(): Promise<HealthStatus> {
    const checks: HealthStatus["checks"] = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = { status: "ok" };
    } catch (error) {
      checks.db = { status: "fail", detail: error instanceof Error ? error.message : "unknown" };
    }

    const redis = new Redis(this.config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    try {
      await redis.connect();
      await redis.ping();
      checks.redis = { status: "ok" };
    } catch (error) {
      checks.redis = { status: "fail", detail: error instanceof Error ? error.message : "unknown" };
    } finally {
      redis.disconnect();
    }

    checks.collector = {
      status: this.config.get<string>("COLLECTOR_BASE_URL") ? "ok" : "fail",
      detail: this.config.get<string>("COLLECTOR_BASE_URL") ? "configured" : "not configured"
    };
    checks.notifications = { status: "ok", detail: "adapters configured with env fallback" };
    checks.weather = { status: "ok", detail: this.config.get<string>("CWA_API_KEY") ? "cwa adapter" : "fallback adapter" };
    checks.ai = { status: "ok", detail: this.config.get<string>("OPENAI_API_KEY") ? "provider configured" : "deterministic fallback" };

    return {
      status: Object.values(checks).some((check) => check.status === "fail") ? "degraded" : "ok",
      version: process.env.npm_package_version ?? "0.1.0",
      buildTime: process.env.BUILD_TIME ?? "local",
      checks
    };
  }
}
