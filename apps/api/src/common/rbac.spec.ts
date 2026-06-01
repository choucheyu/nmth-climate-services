import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, SSE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Permission, type RoleName } from "@nmth/shared";
import { describe, expect, it, vi } from "vitest";
import { AiController } from "../ai/ai.controller";
import { AlertsController } from "../alerts/alerts.controller";
import { AuditController } from "../audit/audit.controller";
import { AuthService } from "../auth/auth.service";
import { AuthController } from "../auth/auth.controller";
import { CompensationController } from "../compensation/compensation.controller";
import { DevicesController } from "../devices/devices.controller";
import { DevicesService } from "../devices/devices.service";
import { ExhibitionsController } from "../exhibitions/exhibitions.controller";
import { FloorPlansController } from "../floor-plans/floor-plans.controller";
import { HealthController } from "../health/health.controller";
import { IngestController } from "../ingest/ingest.controller";
import { MeasurementsController } from "../measurements/measurements.controller";
import { NotificationsController } from "../notifications/notifications.controller";
import { ReportsController } from "../reports/reports.controller";
import { SyntheticController } from "../synthetic/synthetic.controller";
import { SystemController } from "../system/system.controller";
import { WeatherController } from "../weather/weather.controller";
import { resolveScopedDataProfile } from "./access-scope";
import type { RequestUser } from "./current-user.decorator";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { PermissionsGuard } from "./permissions.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";

function roleUser(role: RoleName): RequestUser {
  return {
    id: `${role.toLowerCase()}-user`,
    email: `${role.toLowerCase()}@example.local`,
    name: role,
    roles: [role],
    permissions: ROLE_PERMISSIONS[role]
  };
}

function guardContext(user: RequestUser, classPermissions: Permission[], handlerPermissions: Permission[]) {
  class Controller {}
  const handler = () => undefined;
  Reflect.defineMetadata(PERMISSIONS_KEY, classPermissions, Controller);
  Reflect.defineMetadata(PERMISSIONS_KEY, handlerPermissions, handler);
  return {
    getClass: () => Controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ user }) })
  } as any;
}

const API_CONTROLLERS = [
  AlertsController,
  AiController,
  AuditController,
  AuthController,
  CompensationController,
  DevicesController,
  ExhibitionsController,
  FloorPlansController,
  HealthController,
  IngestController,
  MeasurementsController,
  NotificationsController,
  ReportsController,
  SyntheticController,
  SystemController,
  WeatherController
] as const;

const EXPECTED_PUBLIC_ROUTES = ["AuthController.login", "HealthController.health", "IngestController.ingest"];
const EXPECTED_AUTH_ONLY_ROUTES = [
  "AuthController.logout",
  "AuthController.me",
  "SystemController.deleteUserPreference",
  "SystemController.upsertUserPreference",
  "SystemController.userPreference"
];

type RouteMatrixEntry = {
  id: string;
  permissions: Permission[];
  public: boolean;
};

function collectRouteMatrix(): RouteMatrixEntry[] {
  const routes: RouteMatrixEntry[] = [];
  for (const controller of API_CONTROLLERS) {
    const controllerPermissions = (Reflect.getMetadata(PERMISSIONS_KEY, controller) ?? []) as Permission[];
    const controllerPublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, controller));
    for (const handlerName of Object.getOwnPropertyNames(controller.prototype)) {
      if (handlerName === "constructor") {
        continue;
      }
      const handler = controller.prototype[handlerName as keyof typeof controller.prototype];
      if (typeof handler !== "function") {
        continue;
      }
      const routePath = Reflect.getMetadata(PATH_METADATA, handler);
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      const isSseRoute = Boolean(Reflect.getMetadata(SSE_METADATA, handler));
      if (routePath === undefined && httpMethod === undefined && !isSseRoute) {
        continue;
      }
      const handlerPermissions = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as Permission[];
      const routePublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? controllerPublic);
      routes.push({
        id: `${controller.name}.${handlerName}`,
        permissions: Array.from(new Set<Permission>([...controllerPermissions, ...handlerPermissions])),
        public: routePublic
      });
    }
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

describe("RBAC role matrix", () => {
  it("matches the commercial role expectations", () => {
    expect(ROLE_PERMISSIONS.Viewer).toEqual(
      expect.arrayContaining(["dashboard:read", "reports:read", "devices:read", "exhibitions:read", "floorplans:read", "alerts:read"])
    );
    expect(ROLE_PERMISSIONS.Viewer).not.toEqual(expect.arrayContaining(["system:manage", "devices:manage", "reports:export", "alerts:ack"]));

    expect(ROLE_PERMISSIONS.Operator).toEqual(expect.arrayContaining(["reports:export", "alerts:ack"]));
    expect(ROLE_PERMISSIONS.Operator).not.toEqual(expect.arrayContaining(["devices:manage", "exhibitions:manage", "system:manage"]));

    expect(ROLE_PERMISSIONS.Manager).toEqual(expect.arrayContaining(["exhibitions:manage", "floorplans:manage", "thresholds:manage"]));
    expect(ROLE_PERMISSIONS.Manager).not.toEqual(expect.arrayContaining(["devices:manage", "users:manage", "notifications:manage"]));

    expect(ROLE_PERMISSIONS.Admin).toEqual(expect.arrayContaining(["devices:manage", "users:manage", "system:manage", "notifications:manage", "ingest:write"]));
    expect(ROLE_PERMISSIONS.Admin).not.toEqual(expect.arrayContaining(["compensation:manage", "synthetic:manage", "dangerous:delete"]));

    expect(ROLE_PERMISSIONS.SuperAdmin).toEqual(expect.arrayContaining(["compensation:manage", "synthetic:manage", "dangerous:delete"]));
  });
});

describe("API route permission matrix", () => {
  it("classifies every controller route, including SSE routes", () => {
    const routes = collectRouteMatrix();
    expect(routes.length).toBeGreaterThanOrEqual(79);
    expect(routes.map((route) => route.id)).toContain("IngestController.stream");
  });

  it("keeps public routes explicit and expected", () => {
    const publicRoutes = collectRouteMatrix()
      .filter((route) => route.public)
      .map((route) => route.id);
    expect(publicRoutes).toEqual([...EXPECTED_PUBLIC_ROUTES].sort());
  });

  it("does not leave unexpected auth-only controller routes", () => {
    const authOnlyRoutes = collectRouteMatrix()
      .filter((route) => !route.public && route.permissions.length === 0)
      .map((route) => route.id);
    expect(authOnlyRoutes).toEqual([...EXPECTED_AUTH_ONLY_ROUTES].sort());
  });

  it("maps every permission key to at least one protected route", () => {
    const protectedPermissions = new Set(
      collectRouteMatrix()
        .filter((route) => !route.public)
        .flatMap((route) => route.permissions)
    );
    expect(PERMISSIONS.filter((permission) => !protectedPermissions.has(permission))).toEqual([]);
  });

  it("enforces every protected route against every commercial role", () => {
    const guard = new PermissionsGuard(new Reflector());
    for (const route of collectRouteMatrix().filter((item) => !item.public && item.permissions.length > 0)) {
      for (const role of ROLES) {
        const allowed = route.permissions.every((permission) => ROLE_PERMISSIONS[role].includes(permission));
        if (allowed) {
          expect(guard.canActivate(guardContext(roleUser(role), [], route.permissions)), `${role} should access ${route.id}`).toBe(true);
        } else {
          expect(() => guard.canActivate(guardContext(roleUser(role), [], route.permissions)), `${role} should not access ${route.id}`).toThrow(
            ForbiddenException
          );
        }
      }
    }
  });
});

describe("PermissionsGuard", () => {
  it("merges class and method permissions so method metadata cannot weaken class requirements", () => {
    const guard = new PermissionsGuard(new Reflector());
    expect(() => guard.canActivate(guardContext(roleUser("Admin"), ["system:manage"], ["dangerous:delete"]))).toThrow(ForbiddenException);
    expect(guard.canActivate(guardContext(roleUser("SuperAdmin"), ["system:manage"], ["dangerous:delete"]))).toBe(true);
  });

  it("enforces expected role behavior for common protected operations", () => {
    const guard = new PermissionsGuard(new Reflector());
    expect(() => guard.canActivate(guardContext(roleUser("Viewer"), [], ["users:manage"]))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(guardContext(roleUser("Viewer"), [], ["notifications:manage"]))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(guardContext(roleUser("Viewer"), [], ["system:manage"]))).toThrow(ForbiddenException);

    expect(guard.canActivate(guardContext(roleUser("Operator"), [], ["alerts:ack"]))).toBe(true);
    expect(guard.canActivate(guardContext(roleUser("Operator"), ["devices:read"], ["reports:export"]))).toBe(true);
    expect(() => guard.canActivate(guardContext(roleUser("Operator"), [], ["devices:manage"]))).toThrow(ForbiddenException);

    expect(guard.canActivate(guardContext(roleUser("Manager"), ["floorplans:read"], ["floorplans:manage"]))).toBe(true);
    expect(guard.canActivate(guardContext(roleUser("Manager"), ["exhibitions:read"], ["thresholds:manage"]))).toBe(true);
    expect(() => guard.canActivate(guardContext(roleUser("Manager"), [], ["users:manage"]))).toThrow(ForbiddenException);

    expect(guard.canActivate(guardContext(roleUser("Admin"), [], ["users:manage"]))).toBe(true);
    expect(() => guard.canActivate(guardContext(roleUser("Admin"), [], ["compensation:manage"]))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(guardContext(roleUser("Admin"), [], ["dangerous:delete"]))).toThrow(ForbiddenException);

    expect(guard.canActivate(guardContext(roleUser("SuperAdmin"), [], ["synthetic:manage"]))).toBe(true);
    expect(guard.canActivate(guardContext(roleUser("SuperAdmin"), [], ["dangerous:delete"]))).toBe(true);
  });

  it("requires dangerous delete for user and role deletion metadata", () => {
    const userDelete = Reflect.getMetadata(PERMISSIONS_KEY, SystemController.prototype.deleteUser);
    const roleDelete = Reflect.getMetadata(PERMISSIONS_KEY, SystemController.prototype.deleteRole);
    expect(userDelete).toEqual(["users:manage", "dangerous:delete"]);
    expect(roleDelete).toEqual(["users:manage", "dangerous:delete"]);
  });
});

describe("DB-authoritative role permissions", () => {
  it("does not add static default permissions back during session resolution", async () => {
    const prisma = {
      userSession: {
        findUnique: vi.fn(async () => ({
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: "admin-1",
            email: "admin@example.local",
            name: "Admin",
            enabled: true,
            roles: [{ role: { name: "Admin", permissions: [] } }],
            accessScope: null
          }
        }))
      }
    };
    const service = new AuthService(prisma as any, {} as any);
    const user = await service.resolveSession("session-token");
    expect(user?.roles).toEqual(["Admin"]);
    expect(user?.permissions).toEqual([]);
  });

  it("locks the seeded Demo Viewer session to Viewer and DEMO even if DB state drifts", async () => {
    const prisma = {
      userSession: {
        findUnique: vi.fn(async () => ({
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: "viewer-1",
            email: "viewer@example.local",
            name: "Demo Viewer",
            enabled: true,
            roles: [
              {
                role: {
                  name: "SuperAdmin",
                  permissions: [{ permission: { key: "dangerous:delete" } }]
                }
              }
            ],
            accessScope: { allowedDataProfiles: ["REAL"], exhibitionIds: ["real-exhibition"], zoneIds: [] }
          }
        }))
      }
    };
    const service = new AuthService(prisma as any, {} as any);
    const user = await service.resolveSession("session-token");
    expect(user?.roles).toEqual(["Viewer"]);
    expect(user?.permissions).toEqual(ROLE_PERMISSIONS.Viewer);
    expect(user?.accessScope).toEqual({ dataProfiles: ["DEMO"], exhibitionIds: [], zoneIds: [] });
  });
});

describe("dataProfile access scopes", () => {
  const demoViewer: RequestUser = {
    ...roleUser("Viewer"),
    name: "Demo Viewer",
    accessScope: { dataProfiles: ["DEMO"], exhibitionIds: [], zoneIds: [] }
  };

  it("forces Demo Viewer to DEMO when the global active profile is REAL", async () => {
    const prisma = { systemSetting: { findUnique: vi.fn(async () => ({ value: { profile: "REAL" } })) } };
    await expect(resolveScopedDataProfile(prisma as any, demoViewer)).resolves.toBe("DEMO");
    await expect(resolveScopedDataProfile(prisma as any, demoViewer, "REAL")).rejects.toThrow(ForbiddenException);
  });

  it("applies scoped dataProfile filters to device reads", async () => {
    const prisma = {
      systemSetting: { findUnique: vi.fn(async () => ({ value: { profile: "REAL" } })) },
      device: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0)
      },
      $transaction: vi.fn(async (promises: Array<Promise<unknown>>) => Promise.all(promises))
    };
    const service = new DevicesService(prisma as any, {} as any);
    await service.list({}, demoViewer);
    expect(prisma.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dataProfile: "DEMO" }) }));
    expect(prisma.device.count).toHaveBeenCalledWith({ where: expect.objectContaining({ dataProfile: "DEMO" }) });
  });
});

describe("security audit logging", () => {
  it("keeps high-risk management mutations covered by audit actions", () => {
    const source = [
      "src/system/system.controller.ts",
      "src/exhibitions/exhibitions.service.ts",
      "src/floor-plans/floor-plans.service.ts"
    ]
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n");
    const expectedActions = [
      "user.create",
      "user.update",
      "user.delete",
      "role.create",
      "role.update",
      "role.delete",
      "system.data_profile.switch",
      "system.setting.upsert",
      "retention_policy.create",
      "backup_job.create",
      "exhibition.create",
      "exhibition.update",
      "exhibition.archive",
      "exhibition_zone.create",
      "exhibition_zone.update",
      "threshold_profile.create",
      "threshold_assignment.create",
      "floor_plan.create",
      "floor_plan.set_active_version",
      "floor_plan.archive",
      "floor_plan_version.create",
      "floor_plan_version.update",
      "floor_plan_version.archive",
      "floor_plan_point.create",
      "floor_plan_point.update",
      "floor_plan_point.archive"
    ];

    for (const action of expectedActions) {
      expect(source, `${action} should remain audit-covered`).toContain(`action: "${action}"`);
    }
  });

  it("rejects Demo Viewer role or dataProfile drift through user management", async () => {
    const prisma = {
      role: { findUniqueOrThrow: vi.fn(async () => ({ id: "viewer-role", name: "Viewer" })) }
    };
    const controller = new SystemController(prisma as any);
    await expect((controller as any).assertDemoViewerBoundary("viewer@example.local", ["admin-role"], undefined)).rejects.toThrow(BadRequestException);
    await expect(
      (controller as any).assertDemoViewerBoundary("viewer@example.local", ["viewer-role"], {
        dataProfiles: ["REAL"],
        exhibitionIds: [],
        zoneIds: []
      })
    ).rejects.toThrow(BadRequestException);
    await expect(
      (controller as any).assertDemoViewerBoundary("viewer@example.local", ["viewer-role"], {
        dataProfiles: ["DEMO"],
        exhibitionIds: [],
        zoneIds: []
      })
    ).resolves.toBeUndefined();
  });

  it("prevents Admin from assigning SuperAdmin or permissions Admin does not have", async () => {
    const prisma = {
      role: {
        findMany: vi.fn(async () => [
          {
            id: "superadmin-role",
            name: "SuperAdmin",
            permissions: [{ permission: { key: "dangerous:delete" } }]
          }
        ])
      }
    };
    const controller = new SystemController(prisma as any);
    await expect((controller as any).assertAssignableRoles(roleUser("Admin"), ["superadmin-role"])).rejects.toThrow(ForbiddenException);

    prisma.role.findMany = vi.fn(async () => [
      {
        id: "compensation-role",
        name: "Compensation Operator",
        permissions: [{ permission: { key: "compensation:manage" } }]
      }
    ]);
    await expect((controller as any).assertAssignableRoles(roleUser("Admin"), ["compensation-role"])).rejects.toThrow(ForbiddenException);
  });

  it("allows Admin to assign roles within Admin's own permissions", async () => {
    const prisma = {
      role: {
        findMany: vi.fn(async () => [
          {
            id: "manager-role",
            name: "Manager",
            permissions: [
              { permission: { key: "exhibitions:manage" } },
              { permission: { key: "floorplans:manage" } },
              { permission: { key: "thresholds:manage" } }
            ]
          }
        ])
      }
    };
    const controller = new SystemController(prisma as any);
    await expect((controller as any).assertAssignableRoles(roleUser("Admin"), ["manager-role"])).resolves.toBeUndefined();
  });

  it("prevents Admin from creating or editing roles with SuperAdmin-only authority", () => {
    const controller = new SystemController({} as any);
    expect(() => (controller as any).assertRoleDefinitionAllowed(roleUser("Admin"), "SuperAdmin", ROLE_PERMISSIONS.Admin)).toThrow(ForbiddenException);
    expect(() =>
      (controller as any).assertRoleDefinitionAllowed(roleUser("Admin"), "Compensation Operator", ["compensation:manage"])
    ).toThrow(ForbiddenException);
    expect(() => (controller as any).assertRoleDefinitionAllowed(roleUser("Admin"), "Admin Delegate", ROLE_PERMISSIONS.Admin)).not.toThrow();
  });

  it("writes an audit log for system setting updates", async () => {
    const prisma = {
      systemSetting: {
        findUnique: vi.fn(async () => ({ id: "setting-1", key: "retention", value: { days: 30 } })),
        upsert: vi.fn(async () => ({ id: "setting-1", key: "retention", value: { days: 90 } }))
      },
      auditLog: { create: vi.fn(async () => ({ id: "audit-1" })) }
    };
    const controller = new SystemController(prisma as any);
    await controller.upsertSetting({ key: "retention", value: { days: 90 } }, roleUser("Admin"));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "system.setting.upsert",
        entityType: "system_setting",
        entityId: "setting-1",
        userId: "admin-user"
      })
    });
  });
});
