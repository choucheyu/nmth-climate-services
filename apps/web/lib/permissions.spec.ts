import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type RoleName } from "@nmth/shared";
import zhTW from "@nmth/shared/messages/zh-TW";
import en from "@nmth/shared/messages/en";
import ja from "@nmth/shared/messages/ja";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api";
import { hasPermission, visibleNavKeys, visibleSettingsTabKeys } from "./permissions";

describe("frontend permission rules", () => {
  it("filters AppShell navigation by effective permissions", () => {
    expect(visibleNavKeys(ROLE_PERMISSIONS.Viewer)).toEqual(["dashboard", "devices", "exhibitions", "alerts", "reports"]);
    expect(visibleNavKeys(ROLE_PERMISSIONS.Viewer)).not.toContain("settings");
    expect(visibleNavKeys(ROLE_PERMISSIONS.Admin)).toContain("settings");
    expect(visibleNavKeys(["audit:read"])).toEqual(["settings"]);
  });

  it("keeps every role's visible product surface explicit", () => {
    const expected: Record<RoleName, { nav: string[]; settings: string[] }> = {
      Viewer: { nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"], settings: [] },
      Operator: { nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"], settings: [] },
      Manager: { nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"], settings: [] },
      Admin: {
        nav: ["dashboard", "devices", "exhibitions", "alerts", "reports", "settings"],
        settings: ["health", "users", "notifications", "audit", "super-admin"]
      },
      SuperAdmin: {
        nav: ["dashboard", "devices", "exhibitions", "alerts", "reports", "settings"],
        settings: ["health", "users", "notifications", "audit", "super-admin"]
      }
    };

    for (const role of ROLES) {
      expect(visibleNavKeys(ROLE_PERMISSIONS[role]), `${role} nav`).toEqual(expected[role].nav);
      expect(visibleSettingsTabKeys(ROLE_PERMISSIONS[role]), `${role} settings`).toEqual(expected[role].settings);
    }
  });

  it("maps settings tabs to the required permissions", () => {
    expect(visibleSettingsTabKeys(ROLE_PERMISSIONS.Viewer)).toEqual([]);
    expect(visibleSettingsTabKeys(ROLE_PERMISSIONS.Admin)).toEqual(expect.arrayContaining(["health", "users", "notifications", "audit", "super-admin"]));
    expect(visibleSettingsTabKeys(ROLE_PERMISSIONS.Operator)).toEqual([]);
    expect(visibleSettingsTabKeys(ROLE_PERMISSIONS.Manager)).toEqual([]);
    expect(visibleSettingsTabKeys(["users:manage"])).toEqual(["users"]);
  });

  it("captures page action permissions for devices, exhibitions, alerts, reports, and high-risk actions", () => {
    expect(hasPermission(ROLE_PERMISSIONS.Viewer, "devices:manage")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.Viewer, "thresholds:manage")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.Manager, "floorplans:manage")).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.Manager, "thresholds:manage")).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.Operator, "alerts:ack")).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.Viewer, "alerts:ack")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.Operator, "reports:export")).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.Viewer, "reports:export")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.Admin, "dangerous:delete")).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.SuperAdmin, "dangerous:delete")).toBe(true);
  });

  it("makes Dashboard FloorPlanDashboard editable for floor plan managers only", () => {
    const source = readFileSync(resolve(process.cwd(), "app/[locale]/dashboard/page.tsx"), "utf8");
    expect(source).toContain('hasPermission("floorplans:manage")');
    expect(source).toContain("editable={canManageFloorPlans}");
    expect(source).not.toContain("editable={false}");
  });
});

describe("RBAC i18n coverage", () => {
  const locales = [zhTW, en, ja] as const;

  it("localizes role labels and descriptions in zh-TW, en, and ja", () => {
    for (const messages of locales) {
      for (const role of ROLES) {
        expect(messages.rbac.roles[role].label).toBeTruthy();
        expect(messages.rbac.roles[role].description).toBeTruthy();
      }
    }
  });

  it("localizes permission labels and descriptions in zh-TW, en, and ja", () => {
    for (const messages of locales) {
      for (const permission of PERMISSIONS) {
        expect(messages.rbac.permissions[permission].label).toBeTruthy();
        expect(messages.rbac.permissions[permission].description).toBeTruthy();
        expect(messages.rbac.permissions[permission].label).not.toBe(permission);
      }
    }
  });
});

describe("apiFetch authorization errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it("dispatches a centralized forbidden event for 403 responses", async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = { dispatchEvent };
    (globalThis as any).CustomEvent = class {
      constructor(
        readonly type: string,
        readonly init: unknown
      ) {}
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Insufficient permissions"
    } as Response);

    await expect(apiFetch("/system/users")).rejects.toBeInstanceOf(ApiError);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "nmth:api-forbidden" }));
  });
});
