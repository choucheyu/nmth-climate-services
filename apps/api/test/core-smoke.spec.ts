import "reflect-metadata";
import cookieParser from "cookie-parser";
import { INestApplication } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AlertsController } from "../src/alerts/alerts.controller";
import { AlertsService } from "../src/alerts/alerts.service";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { SessionAuthGuard } from "../src/common/auth.guard";
import type { RequestUser } from "../src/common/current-user.decorator";
import { PermissionsGuard } from "../src/common/permissions.guard";
import { CompensationController } from "../src/compensation/compensation.controller";
import { CompensationService } from "../src/compensation/compensation.service";
import { DevicesController } from "../src/devices/devices.controller";
import { DevicesService } from "../src/devices/devices.service";
import { ExhibitionsController } from "../src/exhibitions/exhibitions.controller";
import { ExhibitionsService } from "../src/exhibitions/exhibitions.service";
import { HealthController } from "../src/health/health.controller";
import { HealthService } from "../src/health/health.service";
import { MeasurementsController } from "../src/measurements/measurements.controller";
import { MeasurementsService } from "../src/measurements/measurements.service";
import { ReportsController } from "../src/reports/reports.controller";
import { ReportsService } from "../src/reports/reports.service";
import { SyntheticController } from "../src/synthetic/synthetic.controller";
import { SyntheticService } from "../src/synthetic/synthetic.service";

const viewerUser: RequestUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "viewer@example.local",
  name: "Demo Viewer",
  roles: ["Viewer"],
  permissions: ["dashboard:read", "reports:read", "devices:read", "exhibitions:read", "floorplans:read", "alerts:read"]
};

const superAdminUser: RequestUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "superadmin@example.local",
  name: "NMTH Super Admin",
  roles: ["SuperAdmin"],
  permissions: [
    "dashboard:read",
    "reports:read",
    "reports:export",
    "alerts:read",
    "alerts:ack",
    "devices:read",
    "devices:manage",
    "exhibitions:read",
    "exhibitions:manage",
    "floorplans:read",
    "floorplans:manage",
    "thresholds:manage",
    "notifications:manage",
    "users:manage",
    "system:manage",
    "audit:read",
    "compensation:manage",
    "synthetic:manage",
    "dangerous:delete",
    "ingest:write"
  ]
};

describe("core HTTP smoke", () => {
  let app: INestApplication;
  let baseUrl: string;
  let viewerCookie: string;
  let superAdminCookie: string;

  beforeAll(async () => {
    const authService = {
      login: async ({ email }: { email: string }) => {
        const user = email.includes("superadmin") ? superAdminUser : viewerUser;
        const token = email.includes("superadmin") ? "super-token" : "viewer-token";
        return { token, user, expiresAt: new Date(Date.now() + 60 * 60_000) };
      },
      logout: async () => undefined,
      resolveSession: async (token: string) => {
        if (token === "super-token") return superAdminUser;
        if (token === "viewer-token") return viewerUser;
        return null;
      }
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AlertsController,
        AuthController,
        CompensationController,
        DevicesController,
        ExhibitionsController,
        HealthController,
        MeasurementsController,
        ReportsController,
        SyntheticController
      ],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: HealthService,
          useValue: {
            check: async () => ({
              status: "ok",
              version: "test",
              buildTime: "test",
              checks: { db: { status: "ok" }, redis: { status: "ok" } }
            })
          }
        },
        {
          provide: ExhibitionsService,
          useValue: {
            list: async () => ({ items: [{ id: "exhibition-1", code: "NMTH-CLIMATE-SEED", name: "常設展環境監測" }], total: 1, page: 1, pageSize: 25 })
          }
        },
        {
          provide: DevicesService,
          useValue: {
            list: async () => ({ items: [{ id: "device-1", deviceName: "00001", displayName: "入口環境點 00001" }], total: 1, page: 1, pageSize: 25 })
          }
        },
        {
          provide: MeasurementsService,
          useValue: {
            latestOverview: async () => ({
              summary: { total: 1, normal: 1, warning: 0, critical: 0, offline: 0, averageTemperature: 23.4, averageHumidity: 55.2 },
              devices: [{ id: "device-1", deviceName: "00001", latestMeasurement: { temperatureC: 23.4, humidityPercent: 55.2 } }]
            }),
            trend24h: async () => [
              {
                measuredAt: new Date().toISOString(),
                deviceId: "device-1",
                source: "real",
                temperatureC: 23.4,
                humidityPercent: 55.2,
                dehumidifySetpoint: 52
              }
            ],
            reportRows: async () => [
              {
                measuredAt: new Date(),
                date: "2026-05-12",
                time: "10:00:00",
                exhibition: "常設展環境監測",
                zone: "展區 A",
                point: "入口環境點 00001",
                deviceName: "00001",
                displayName: "入口環境點 00001",
                dehumidifySetpoint: 52,
                temperatureC: 23.4,
                humidityPercent: 55.2,
                source: "real",
                qualityFlags: []
              }
            ]
          }
        },
        {
          provide: ReportsService,
          useValue: {
            export: async () => ({ contentType: "text/csv; charset=utf-8", filename: "test.csv", body: "date,time\n2026-05-12,10:00:00" }),
            createScheduledReport: async () => ({ id: "schedule-1" })
          }
        },
        {
          provide: AlertsService,
          useValue: {
            list: async () => ({ items: [{ id: "alert-1", status: "active", level: "warning", title: "Device offline" }], total: 1, page: 1, pageSize: 25 }),
            acknowledge: async () => ({ id: "alert-1", status: "acknowledged" }),
            detectOffline: async () => 1
          }
        },
        {
          provide: CompensationService,
          useValue: {
            detectGaps: async () => [],
            generate: async () => ({ adjustmentId: "adjustment-1", created: 2 })
          }
        },
        {
          provide: SyntheticService,
          useValue: {
            generateTargetApproach: async () => ({ adjustmentId: "adjustment-2", created: 2 })
          }
        },
        Reflector,
        {
          provide: APP_GUARD,
          inject: [Reflector, AuthService],
          useFactory: (reflector: Reflector, service: AuthService) => new SessionAuthGuard(reflector, service)
        },
        {
          provide: APP_GUARD,
          inject: [Reflector],
          useFactory: (reflector: Reflector) => new PermissionsGuard(reflector)
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api", { exclude: ["health"] });
    app.use(cookieParser());
    await app.listen(0);
    baseUrl = await app.getUrl();

    viewerCookie = await login("viewer@example.local");
    superAdminCookie = await login("superadmin@example.local");
  });

  afterAll(async () => {
    await app.close();
  });

  it("has a valid Prisma schema", () => {
    expect(() =>
      execFileSync("pnpm", ["exec", "prisma", "validate"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://nmth_user:nmth_password@localhost:5432/nmth_climate?schema=public"
        },
        stdio: "pipe"
      })
    ).not.toThrow();
  });

  async function login(email: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "DemoPass123!" })
    });
    expect(response.status).toBe(201);
    const sessionCookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toContain("nmth_session=");
    return sessionCookie!;
  }

  it("serves health without a session", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("allows authenticated dashboard, lists, trends, reports, and alerts", async () => {
    const smokeDeviceId = "14000000-0000-4000-8000-000000000001";
    const endpoints = [
      "/api/auth/me",
      "/api/exhibitions",
      "/api/devices",
      "/api/measurements/overview",
      `/api/measurements/trend-24h?deviceId=${smokeDeviceId}`,
      `/api/measurements/report?start=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60_000).toISOString())}&end=${encodeURIComponent(new Date().toISOString())}&deviceIds=${smokeDeviceId}`,
      "/api/alerts"
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(`${baseUrl}${endpoint}`, { headers: { cookie: viewerCookie } });
      expect(response.status, endpoint).toBe(200);
      await expect(response.json()).resolves.toBeTruthy();
    }
  });

  it("restricts compensation and derived-data operations to SuperAdmin", async () => {
    const body = JSON.stringify({
      deviceId: "00000000-0000-4000-8000-000000000123",
      start: new Date(Date.now() - 60 * 60_000).toISOString(),
      end: new Date().toISOString(),
      method: "linear_interpolation",
      approachFactor: 0.65,
      reason: "smoke test high risk operation",
      confirmationText: "CONFIRM"
    });

    const viewerResponse = await fetch(`${baseUrl}/api/compensation/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body
    });
    expect(viewerResponse.status).toBe(403);

    const superAdminCompensation = await fetch(`${baseUrl}/api/compensation/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superAdminCookie },
      body
    });
    expect(superAdminCompensation.status).toBe(201);

    const superAdminDerived = await fetch(`${baseUrl}/api/synthetic/target-approach`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superAdminCookie },
      body
    });
    expect(superAdminDerived.status).toBe(201);
  });
});
