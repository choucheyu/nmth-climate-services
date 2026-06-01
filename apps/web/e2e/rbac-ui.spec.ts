import { expect, test, type Page } from "@playwright/test";

type RoleName = "Viewer" | "Operator" | "Manager" | "Admin" | "SuperAdmin";

const baseUrl = process.env.RBAC_E2E_BASE_URL ?? "http://127.0.0.1:3251";

const navLabels = {
  dashboard: "即時儀表板",
  devices: "設備管理",
  exhibitions: "展覽與溫溼度點",
  alerts: "警報中心",
  reports: "圖表與報表",
  settings: "系統設定"
} as const;

const settingsTabLabels = {
  health: "系統健康",
  users: "人員與角色",
  notifications: "通知通道",
  audit: "稽核紀錄",
  "super-admin": "高風險操作確認"
} as const;

const roleMatrix: Array<{
  role: RoleName;
  email: string;
  password: string;
  nav: Array<keyof typeof navLabels>;
  settingsTabs: Array<keyof typeof settingsTabLabels>;
  canEditFloorPlan: boolean;
}> = [
  {
    role: "Viewer",
    email: process.env.RBAC_E2E_VIEWER_EMAIL ?? "viewer@example.local",
    password: process.env.RBAC_E2E_VIEWER_PASSWORD ?? "DemoPass123!",
    nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"],
    settingsTabs: [],
    canEditFloorPlan: false
  },
  {
    role: "Operator",
    email: process.env.RBAC_E2E_OPERATOR_EMAIL ?? "operator@example.local",
    password: process.env.RBAC_E2E_OPERATOR_PASSWORD ?? "DemoPass123!",
    nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"],
    settingsTabs: [],
    canEditFloorPlan: false
  },
  {
    role: "Manager",
    email: process.env.RBAC_E2E_MANAGER_EMAIL ?? "manager@example.local",
    password: process.env.RBAC_E2E_MANAGER_PASSWORD ?? "DemoPass123!",
    nav: ["dashboard", "devices", "exhibitions", "alerts", "reports"],
    settingsTabs: [],
    canEditFloorPlan: true
  },
  {
    role: "Admin",
    email: process.env.RBAC_E2E_ADMIN_EMAIL ?? "admin@example.local",
    password: process.env.RBAC_E2E_ADMIN_PASSWORD ?? "DemoPass123!",
    nav: ["dashboard", "devices", "exhibitions", "alerts", "reports", "settings"],
    settingsTabs: ["health", "users", "notifications", "audit", "super-admin"],
    canEditFloorPlan: true
  },
  {
    role: "SuperAdmin",
    email: process.env.RBAC_E2E_SUPERADMIN_EMAIL ?? "superadmin@example.local",
    password: process.env.RBAC_E2E_SUPERADMIN_PASSWORD ?? "DemoPass123!",
    nav: ["dashboard", "devices", "exhibitions", "alerts", "reports", "settings"],
    settingsTabs: ["health", "users", "notifications", "audit", "super-admin"],
    canEditFloorPlan: true
  }
];

async function login(page: Page, account: { email: string; password: string }) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/login", {
    data: { email: account.email, password: account.password }
  });
  expect(response.ok(), `${account.email} should login before browser RBAC checks`).toBe(true);
  const sessionToken = response.headers()["set-cookie"]?.match(/nmth_session=([^;]+)/)?.[1];
  expect(sessionToken, `${account.email} login should set nmth_session cookie`).toBeTruthy();
  await page.context().addCookies([
    {
      name: "nmth_session",
      value: sessionToken!,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
  await page.goto("/zh-TW/dashboard");
  await expect(page.getByRole("heading", { name: navLabels.dashboard })).toBeVisible();
}

async function expectNavigation(page: Page, visibleKeys: Array<keyof typeof navLabels>) {
  const visible = new Set(visibleKeys);
  for (const [key, label] of Object.entries(navLabels) as Array<[keyof typeof navLabels, string]>) {
    const item = page.getByRole("menuitem", { name: label });
    if (visible.has(key)) {
      await expect(item, `${label} nav should be visible`).toBeVisible();
    } else {
      await expect(item, `${label} nav should be hidden`).toHaveCount(0);
    }
  }
}

async function expectDashboardFloorPlanEdit(page: Page, canEdit: boolean) {
  await page.goto("/zh-TW/dashboard");
  await expect(page.getByRole("heading", { name: navLabels.dashboard })).toBeVisible();
  const floorTab = page.getByRole("tab", { name: "平面圖" }).last();
  await expect(floorTab).toBeVisible({ timeout: 20_000 });
  await floorTab.click();

  const editButton = page.getByRole("button", { name: /唯讀模式|編輯模式/ }).first();
  await expect(editButton).toBeVisible({ timeout: 20_000 });
  if (canEdit) {
    await expect(editButton, "floor plan edit button should be enabled").toBeEnabled();
  } else {
    await expect(editButton, "floor plan edit button should be read-only").toBeDisabled();
  }
}

async function selectDashboardFloorPlanWithCallouts(page: Page) {
  await page.goto("/zh-TW/dashboard");
  await expect(page.getByRole("heading", { name: navLabels.dashboard })).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const exhibitionTabs = page.getByRole("tablist").first().getByRole("tab");
  await expect(exhibitionTabs.first()).toBeVisible({ timeout: 20_000 });
  const tabCount = await exhibitionTabs.count();

  for (let index = 0; index < tabCount; index += 1) {
    const tab = exhibitionTabs.nth(index);
    const label = (await tab.textContent())?.trim() ?? "";
    await tab.click();
    await page.getByRole("tab", { name: "平面圖" }).last().click();
    const callouts = page.locator(".nmth-floor-plan-callout-card");
    try {
      await expect(callouts.first()).toBeVisible({ timeout: 10_000 });
      await page.waitForFunction(
        () => {
          const background = document.querySelector(
            "[data-testid='floor-plan-visual-surface'] canvas, [data-testid='floor-plan-visual-surface'] img",
          );
          return Boolean(background && background.getBoundingClientRect().width > 500);
        },
        null,
        { timeout: 10_000 },
      );
      return { label, count: await callouts.count() };
    } catch {
      continue;
    }
  }

  throw new Error("Expected at least one dashboard floor plan with callouts");
}

async function expectSettingsSurface(page: Page, visibleTabs: Array<keyof typeof settingsTabLabels>) {
  await page.goto("/zh-TW/settings");
  if (!visibleTabs.length) {
    await expect(page.getByText("沒有權限")).toBeVisible();
    await expect(page.getByText("人員與角色")).toHaveCount(0);
    await expect(page.getByText("高風險操作確認")).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("heading", { name: navLabels.settings })).toBeVisible();
  const visible = new Set(visibleTabs);
  for (const [key, label] of Object.entries(settingsTabLabels) as Array<[keyof typeof settingsTabLabels, string]>) {
    const tab = page.getByRole("tab", { name: label });
    if (visible.has(key)) {
      await expect(tab, `${label} settings tab should be visible`).toBeVisible();
    } else {
      await expect(tab, `${label} settings tab should be hidden`).toHaveCount(0);
    }
  }
}

test.describe("RBAC browser UI surface", () => {
  test("dashboard floor plan callouts survive sidebar navigation", async ({ page }) => {
    await login(page, roleMatrix.find((account) => account.role === "Operator")!);
    const floorPlan = await selectDashboardFloorPlanWithCallouts(page);

    await page.getByRole("menuitem", { name: navLabels.devices }).click();
    await page.waitForURL(/\/zh-TW\/devices/);
    await expect(page.getByRole("heading", { name: navLabels.devices })).toBeVisible();

    await page.getByRole("menuitem", { name: navLabels.dashboard }).click();
    await page.waitForURL(/\/zh-TW\/dashboard/);
    await page.getByRole("tab", { name: floorPlan.label }).click();
    await page.getByRole("tab", { name: "平面圖" }).last().click();

    const callouts = page.locator(".nmth-floor-plan-callout-card");
    await expect(callouts.first()).toBeVisible({ timeout: 20_000 });
    await expect(callouts).toHaveCount(floorPlan.count);
  });

  for (const account of roleMatrix) {
    test(`${account.role} sees only the authorized navigation, settings, and floor plan actions`, async ({ page }) => {
      await login(page, account);
      await expectNavigation(page, account.nav);
      await expectDashboardFloorPlanEdit(page, account.canEditFloorPlan);
      await expectSettingsSurface(page, account.settingsTabs);
    });
  }
});
