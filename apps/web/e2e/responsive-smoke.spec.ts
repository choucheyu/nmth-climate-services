import { expect, test, type Page } from "@playwright/test";

const baseUrl = process.env.RBAC_E2E_BASE_URL ?? "http://127.0.0.1:3251";
const account = {
  email: process.env.RBAC_E2E_SUPERADMIN_EMAIL ?? "superadmin@example.local",
  password: process.env.RBAC_E2E_SUPERADMIN_PASSWORD ?? "DemoPass123!",
};
const responsiveSmokeFloorPlanPrefix = "Responsive smoke floor plan";
const responsiveSmokePointPrefix = "Responsive smoke point";

interface ResponsiveSmokeFixture {
  floorPlanId: string;
  floorPlanName: string;
  points: Array<{ id: string; name: string }>;
}

const pages = [
  {
    path: "/zh-TW/dashboard",
    heading: "即時儀表板",
    floorPlan: true,
    reports: false,
  },
  {
    path: "/zh-TW/alerts",
    heading: "警報中心",
    floorPlan: false,
    reports: false,
  },
  {
    path: "/zh-TW/devices",
    heading: "設備管理",
    floorPlan: false,
    reports: false,
  },
  {
    path: "/zh-TW/reports",
    heading: "圖表與報表",
    floorPlan: false,
    reports: true,
  },
  {
    path: "/zh-TW/exhibitions",
    heading: "展覽與溫溼度點管理",
    floorPlan: true,
    reports: false,
  },
  {
    path: "/zh-TW/settings",
    heading: "系統設定",
    floorPlan: false,
    reports: false,
  },
] as const;

const settingsTabLabels = {
  users: "人員與角色",
  notifications: "通知通道",
  audit: "稽核紀錄",
  superAdmin: "高風險操作確認",
} as const;

async function login(page: Page) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/login", {
    data: { email: account.email, password: account.password },
  });
  expect(
    response.ok(),
    `${account.email} should login before responsive smoke`,
  ).toBe(true);
  const sessionToken = response
    .headers()
    ["set-cookie"]?.match(/nmth_session=([^;]+)/)?.[1];
  expect(
    sessionToken,
    `${account.email} login should set nmth_session cookie`,
  ).toBeTruthy();
  await page.context().addCookies([
    {
      name: "nmth_session",
      value: sessionToken!,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function expectNoPageOverflow(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => window.requestAnimationFrame(resolve)),
  );
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      viewportWidth: root.clientWidth,
      pageScrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
    };
  });
  expect(
    metrics.pageScrollWidth,
    "page-level horizontal overflow should stay within the viewport",
  ).toBeLessThanOrEqual(metrics.viewportWidth + 8);
}

async function exitSmokeFullscreenBeforeViewportResize(page: Page) {
  await page.evaluate(async () => {
    try {
      (
        window.screen.orientation as ScreenOrientation & {
          unlock?: () => void;
        }
      )?.unlock?.();
    } catch {
      // Progressive orientation APIs are browser-dependent.
    }

    if (
      document.fullscreenElement &&
      typeof document.exitFullscreen === "function"
    ) {
      await document.exitFullscreen().catch(() => undefined);
    }
  });
}

async function expectMobileViewerContainment(page: Page, label: string) {
  const viewer = page.getByTestId("floor-plan-mobile-viewer");
  const body = page.getByTestId("floor-plan-mobile-viewer-body");
  const surface = page.getByTestId("floor-plan-mobile-viewer-surface");
  await expect(viewer).toBeVisible();
  await expect(body).toBeVisible();
  await expect(surface).toBeVisible();

  await expect
    .poll(
      async () => {
        const [viewerBox, bodyBox, surfaceBox, viewport] = await Promise.all([
          viewer.boundingBox(),
          body.boundingBox(),
          surface.boundingBox(),
          page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            rootClientWidth: document.documentElement.clientWidth,
            rootScrollWidth: document.documentElement.scrollWidth,
          })),
        ]);
        if (!viewerBox || !bodyBox || !surfaceBox) {
          return "missing box";
        }
        const failures: string[] = [];
        if (viewerBox.x < -1 || viewerBox.y < -1)
          failures.push("viewer origin");
        if (viewerBox.x + viewerBox.width > viewport.width + 1)
          failures.push("viewer right");
        if (viewerBox.y + viewerBox.height > viewport.height + 1)
          failures.push("viewer bottom");
        if (surfaceBox.x < bodyBox.x - 1) failures.push("surface left");
        if (surfaceBox.y < bodyBox.y - 1) failures.push("surface top");
        if (surfaceBox.x + surfaceBox.width > bodyBox.x + bodyBox.width + 1)
          failures.push("surface right");
        if (surfaceBox.y + surfaceBox.height > bodyBox.y + bodyBox.height + 1)
          failures.push("surface bottom");
        if (surfaceBox.x + surfaceBox.width > viewport.width + 1)
          failures.push("surface viewport right");
        if (surfaceBox.y + surfaceBox.height > viewport.height + 1)
          failures.push("surface viewport bottom");
        if (viewport.rootScrollWidth > viewport.rootClientWidth + 8)
          failures.push("page horizontal overflow");
        return failures.join(", ") || "contained";
      },
      {
        message: `${label} mobile viewer should contain the full floor-plan surface`,
      },
    )
    .toBe("contained");
}

async function expectFirstMarkerInsideSurface(page: Page) {
  const surface = page.getByTestId("floor-plan-mobile-viewer-surface");
  const firstMarker = page.getByTestId("floor-plan-mobile-marker").first();
  await expect(firstMarker).toBeVisible();

  const surfaceBox = await surface.boundingBox();
  const markerBox = await firstMarker.boundingBox();
  expect(
    surfaceBox,
    "mobile viewer surface should have a rendered box",
  ).toBeTruthy();
  expect(markerBox, "mobile marker should have a rendered box").toBeTruthy();
  const markerCenter = {
    x: markerBox!.x + markerBox!.width / 2,
    y: markerBox!.y + markerBox!.height / 2,
  };
  expect(
    markerCenter.x,
    "marker center should stay inside the mobile floor-plan surface",
  ).toBeGreaterThanOrEqual(surfaceBox!.x - 1);
  expect(
    markerCenter.x,
    "marker center should stay inside the mobile floor-plan surface",
  ).toBeLessThanOrEqual(surfaceBox!.x + surfaceBox!.width + 1);
  expect(
    markerCenter.y,
    "marker center should stay inside the mobile floor-plan surface",
  ).toBeGreaterThanOrEqual(surfaceBox!.y - 1);
  expect(
    markerCenter.y,
    "marker center should stay inside the mobile floor-plan surface",
  ).toBeLessThanOrEqual(surfaceBox!.y + surfaceBox!.height + 1);
}

async function expectCompactCardActions(page: Page) {
  const firstCard = page.locator(".ant-card.nmth-panel").first();
  await expect(firstCard).toBeVisible();
  const visibleButtonCount = await firstCard.locator("button:visible").count();
  expect(
    visibleButtonCount,
    "compact operation cards should not expose dense button clusters",
  ).toBeLessThanOrEqual(1);
}

async function expectCompactDrawerWorkflow(page: Page) {
  const firstActionableCard = page
    .locator(".ant-card.nmth-panel[role='button']")
    .first();
  if ((await firstActionableCard.count()) === 0) {
    return;
  }
  await firstActionableCard.click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

async function expectExhibitionCompactActions(page: Page) {
  const firstExhibitionCard = page.locator(".ant-card.nmth-panel").first();
  await expect(firstExhibitionCard).toBeVisible();
  const exhibitionButtonCount = await firstExhibitionCard
    .locator("button:visible")
    .count();
  expect(
    exhibitionButtonCount,
    "compact exhibition cards should expose a small direct action set",
  ).toBeLessThanOrEqual(3);

  const managementCards = page.locator(".ant-card-small:visible");
  const cardsToCheck = Math.min(await managementCards.count(), 6);
  for (let index = 0; index < cardsToCheck; index += 1) {
    const visibleButtonCount = await managementCards
      .nth(index)
      .locator("button:visible")
      .count();
    expect(
      visibleButtonCount,
      "compact exhibition management cards should not expose dense action clusters",
    ).toBeLessThanOrEqual(4);
  }

  const firstOverflowButton = page
    .getByRole("button", { name: /操作|Actions|アクション/ })
    .first();
  if ((await firstOverflowButton.count()) > 0) {
    await firstOverflowButton.click();
    await page.waitForTimeout(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
}

async function clickTabIfVisible(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  if ((await tab.count()) === 0) {
    return false;
  }
  await tab.click();
  return true;
}

async function closeSettingsModalWithKeyboard(page: Page) {
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (await dialog.isVisible()) {
    const cancelButton = dialog
      .getByRole("button", {
        name: /取\s*消|Cancel|キャンセル|Close|關閉|閉じる/,
      })
      .first();
    if ((await cancelButton.count()) > 0) {
      await cancelButton.focus();
      await page.keyboard.press("Enter");
    }
  }
  await expect(dialog).toBeHidden();
}

async function expectSettingsCompactWorkflow(page: Page) {
  if (await clickTabIfVisible(page, settingsTabLabels.users)) {
    await expect(page.getByTestId("settings-user-card-list")).toBeVisible();
    await expect(page.getByTestId("settings-role-card-list")).toBeVisible();
    await expect(page.locator(".ant-table")).toHaveCount(0);

    const firstUserEdit = page
      .getByTestId("settings-user-card-list")
      .getByRole("button", { name: /編輯/ })
      .first();
    if ((await firstUserEdit.count()) > 0) {
      await firstUserEdit.click();
      await closeSettingsModalWithKeyboard(page);
    }
  }

  if (await clickTabIfVisible(page, settingsTabLabels.notifications)) {
    const notificationsPanel = page.getByRole("tabpanel", {
      name: settingsTabLabels.notifications,
    });
    await expect(notificationsPanel.getByText("LINE").first()).toBeVisible();
    await expect(page.locator(".ant-table")).toHaveCount(0);
  }

  if (await clickTabIfVisible(page, settingsTabLabels.audit)) {
    await expect(page.getByTestId("settings-audit-card-list")).toBeVisible();
    await expect(page.locator(".ant-table")).toHaveCount(0);
  }

  if (await clickTabIfVisible(page, settingsTabLabels.superAdmin)) {
    await expect(page.locator(".ant-table")).toHaveCount(0);
    const adjustmentList = page.getByTestId("settings-adjustment-card-list");
    if ((await adjustmentList.count()) > 0) {
      await expect(adjustmentList).toBeVisible();
    }
  }
}

async function expectReportsTouchControls(page: Page) {
  await expect(page.getByTestId("reports-filter-grid")).toBeVisible();
  await expect(page.getByTestId("reports-interval-field")).toBeVisible();
  await expect(page.getByTestId("reports-search-submit")).toBeVisible();
  await expect(page.getByTestId("reports-quick-range-label-24h")).toBeVisible();
  await expect(page.getByTestId("reports-quick-range-label-7d")).toBeVisible();
  await expect(page.getByTestId("reports-trend-chart-card")).toBeVisible();
}

async function selectDashboardFloorPlanWithViewer(
  page: Page,
  smokeFixtures: ResponsiveSmokeFixture[],
) {
  const openButton = page.getByTestId("floor-plan-mobile-viewer-open");
  if (
    (await openButton.count()) > 0 &&
    (await openButton.first().isVisible())
  ) {
    return true;
  }

  const exhibitionTabs = page.getByRole("tablist").first().getByRole("tab");
  const tabCount = await exhibitionTabs.count();
  for (let index = 0; index < tabCount; index += 1) {
    await exhibitionTabs.nth(index).click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const floorTab = page.getByRole("tab", { name: "平面圖" }).first();
    if ((await floorTab.count()) > 0) {
      await floorTab.click();
    }
    await expect(page.getByTestId("floor-plan-phone-list").first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    if (
      (await openButton.count()) > 0 &&
      (await openButton.first().isVisible())
    ) {
      return true;
    }
  }

  await ensureFloorPlanSmokeFixture(page, smokeFixtures);
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.getByTestId("floor-plan-phone-list").first()).toBeVisible({
    timeout: 20_000,
  });
  return (
    (await openButton.count()) > 0 && (await openButton.first().isVisible())
  );
}

async function ensureFloorPlanSmokeFixture(
  page: Page,
  smokeFixtures: ResponsiveSmokeFixture[],
) {
  const exhibitionsResponse = await page.request.get(
    "/api/exhibitions?page=1&pageSize=50&status=active",
  );
  expect(
    exhibitionsResponse.ok(),
    "responsive smoke should be able to read active exhibitions",
  ).toBe(true);
  const exhibitionsBody = await exhibitionsResponse.json();
  const activeExhibitions = (exhibitionsBody.items ?? []) as Array<{
    id: string;
    name: string;
  }>;

  const targetExhibition = activeExhibitions[0];
  if (!targetExhibition) {
    throw new Error("responsive smoke needs at least one active exhibition");
  }
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const floorPlanName = `${responsiveSmokeFloorPlanPrefix} ${uniqueSuffix}`;
  const pointName = `${responsiveSmokePointPrefix} ${uniqueSuffix}`;
  const createFloorPlanResponse = await page.request.post("/api/floor-plans", {
    data: {
      exhibitionId: targetExhibition.id,
      name: floorPlanName,
    },
  });
  expect(
    createFloorPlanResponse.ok(),
    "responsive smoke should be able to create a floor plan fixture",
  ).toBe(true);
  const floorPlan = await createFloorPlanResponse.json();
  const fixture: ResponsiveSmokeFixture = {
    floorPlanId: floorPlan.id,
    floorPlanName,
    points: [],
  };
  smokeFixtures.push(fixture);

  const createPointResponse = await page.request.post(
    "/api/floor-plans/points",
    {
      data: {
        floorPlanId: floorPlan.id,
        name: pointName,
        xRatio: 0.42,
        yRatio: 0.38,
        deviceId: null,
        zoneId: null,
        thresholdProfileId: null,
      },
    },
  );
  expect(
    createPointResponse.ok(),
    "responsive smoke should be able to create a point fixture",
  ).toBe(true);
  const point = await createPointResponse.json();
  fixture.points.push({ id: point.id, name: pointName });
}

async function cleanupFloorPlanSmokeFixtures(
  page: Page,
  smokeFixtures: ResponsiveSmokeFixture[],
) {
  for (const fixture of [...smokeFixtures].reverse()) {
    if (!fixture.floorPlanName.startsWith(responsiveSmokeFloorPlanPrefix)) {
      throw new Error(
        `Refusing to clean up non-test floor plan ${fixture.floorPlanName}`,
      );
    }

    for (const point of [...fixture.points].reverse()) {
      if (!point.name.startsWith(responsiveSmokePointPrefix)) {
        throw new Error(
          `Refusing to clean up non-test floor-plan point ${point.name}`,
        );
      }
      const pointCleanup = await page.request.post(
        `/api/floor-plans/points/${point.id}/archive`,
        { data: { reason: `responsive smoke cleanup: ${point.name}` } },
      );
      expect(
        pointCleanup.ok() || pointCleanup.status() === 404,
        `responsive smoke should archive point fixture ${point.name}`,
      ).toBe(true);
    }

    const floorPlanCleanup = await page.request.post(
      `/api/floor-plans/${fixture.floorPlanId}/archive`,
      {
        data: { reason: `responsive smoke cleanup: ${fixture.floorPlanName}` },
      },
    );
    expect(
      floorPlanCleanup.ok() || floorPlanCleanup.status() === 404,
      `responsive smoke should archive floor-plan fixture ${fixture.floorPlanName}`,
    ).toBe(true);
  }
  smokeFixtures.length = 0;
}

async function expectMobileFloorPlanViewer(page: Page) {
  await page.getByTestId("floor-plan-mobile-viewer-open").click();
  await expect(page.getByTestId("floor-plan-mobile-viewer")).toBeVisible();
  await expect(
    page.getByTestId("floor-plan-mobile-viewer-rotate-guidance"),
  ).toBeVisible();
  await expectNoPageOverflow(page);

  await exitSmokeFullscreenBeforeViewportResize(page);
  await page.setViewportSize({ width: 844, height: 390 });
  const surface = page.getByTestId("floor-plan-mobile-viewer-surface");
  await expect(surface).toBeVisible({ timeout: 20_000 });
  await expectMobileViewerContainment(page, "844 x 390");
  await expectFirstMarkerInsideSurface(page);

  const firstMarker = page.getByTestId("floor-plan-mobile-marker").first();
  await firstMarker.click();
  const viewer = page.getByTestId("floor-plan-mobile-viewer");
  const popover = viewer.getByTestId("floor-plan-mobile-marker-popover");
  await expect(popover).toBeVisible();
  await expect(
    firstMarker.locator(':scope > span[style*="pointer-events: none"]'),
  ).toHaveCount(0);
  const bodyBox = await page
    .getByTestId("floor-plan-mobile-viewer-body")
    .boundingBox();
  const surfaceBox = await surface.boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(bodyBox, "mobile viewer body should have a rendered box").toBeTruthy();
  expect(
    surfaceBox,
    "mobile viewer surface should have a rendered box",
  ).toBeTruthy();
  expect(
    popoverBox,
    "mobile marker popover should have a rendered box",
  ).toBeTruthy();
  const popoverInsideSurface =
    popoverBox!.x >= surfaceBox!.x - 1 &&
    popoverBox!.y >= surfaceBox!.y - 1 &&
    popoverBox!.x + popoverBox!.width <=
      surfaceBox!.x + surfaceBox!.width + 1 &&
    popoverBox!.y + popoverBox!.height <=
      surfaceBox!.y + surfaceBox!.height + 1;
  const popoverInsideViewerBody =
    popoverBox!.x >= bodyBox!.x - 1 &&
    popoverBox!.y >= bodyBox!.y - 1 &&
    popoverBox!.x + popoverBox!.width <= bodyBox!.x + bodyBox!.width + 1 &&
    popoverBox!.y + popoverBox!.height <= bodyBox!.y + bodyBox!.height + 1;
  expect(
    popoverInsideSurface || popoverInsideViewerBody,
    "marker popover should stay inside the surface or visible viewer body",
  ).toBe(true);
  await expect(viewer.getByText("Raw / Parsed")).toHaveCount(0);
  await expect(viewer.locator(".nmth-floor-plan-callout-card")).toHaveCount(0);
  await expect(viewer.locator(".nmth-floor-plan-callout-anchor")).toHaveCount(
    0,
  );
  await expect(viewer.getByText(/編輯模式|Edit mode|編集モード/)).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 932, height: 430 });
  await expectMobileViewerContainment(page, "932 x 430");
  await expectFirstMarkerInsideSurface(page);
  await expectNoPageOverflow(page);
}

async function expectFloorPlanWorkflow(
  page: Page,
  projectName: string,
  path: string,
  smokeFixtures: ResponsiveSmokeFixture[],
) {
  if (projectName === "mobile") {
    await expect(page.getByTestId("floor-plan-phone-list").first()).toBeVisible(
      { timeout: 20_000 },
    );
    await expect(page.getByTestId("floor-plan-visual-surface")).toHaveCount(0);
    if (path === "/zh-TW/dashboard") {
      expect(
        await selectDashboardFloorPlanWithViewer(page, smokeFixtures),
        "dashboard smoke data should include a floor plan with points for the mobile viewer",
      ).toBe(true);
      await expect(
        page.getByTestId("floor-plan-mobile-viewer-open"),
      ).toBeVisible();
      await expectMobileFloorPlanViewer(page);
    } else if (
      (await page.getByTestId("floor-plan-mobile-viewer-open").count()) > 0
    ) {
      await expect(
        page.getByTestId("floor-plan-mobile-viewer-open"),
      ).toBeVisible();
    }
    return;
  }
  if (projectName === "tablet") {
    await expect(
      page.getByTestId("floor-plan-tablet-inspector").first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("floor-plan-visual-surface")).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId("floor-plan-phone-list")).toHaveCount(0);
  await expect(page.getByTestId("floor-plan-tablet-inspector")).toHaveCount(0);
}

test.describe("responsive operations smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const target of pages) {
    test(`${target.path} loads without page-level horizontal overflow`, async ({
      page,
    }, testInfo) => {
      const smokeFixtures: ResponsiveSmokeFixture[] = [];
      try {
        await page.goto(target.path);
        await expect(
          page.getByRole("heading", { name: target.heading }),
        ).toBeVisible({ timeout: 20_000 });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await expectNoPageOverflow(page);

        if (
          testInfo.project.name === "mobile" ||
          testInfo.project.name === "tablet"
        ) {
          await expect(page.locator(".ant-layout-sider")).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "開啟導覽" }),
          ).toBeVisible();
        }

        if (testInfo.project.name === "tablet") {
          const mainBox = await page.locator(".nmth-main").boundingBox();
          expect(
            mainBox?.width ?? 0,
            "tablet main content should not be squeezed by the shell",
          ).toBeGreaterThan(600);
        }

        if (
          (testInfo.project.name === "mobile" ||
            testInfo.project.name === "tablet") &&
          ["/zh-TW/alerts", "/zh-TW/devices"].includes(target.path)
        ) {
          await expect(page.locator(".ant-pro-table")).toHaveCount(0);
          await expectCompactCardActions(page);
          await expectCompactDrawerWorkflow(page);
        }

        if (
          target.path === "/zh-TW/exhibitions" &&
          testInfo.project.name === "mobile"
        ) {
          await expect(page.locator(".ant-pro-table")).toHaveCount(0);
          await expectExhibitionCompactActions(page);
          await expectNoPageOverflow(page);
        }

        if (
          target.reports &&
          (testInfo.project.name === "mobile" ||
            testInfo.project.name === "tablet")
        ) {
          await expectReportsTouchControls(page);
          await expectNoPageOverflow(page);
        }

        if (
          target.path === "/zh-TW/settings" &&
          (testInfo.project.name === "mobile" ||
            testInfo.project.name === "tablet")
        ) {
          await expectSettingsCompactWorkflow(page);
          await expectNoPageOverflow(page);
        }

        if (target.floorPlan) {
          await expectFloorPlanWorkflow(
            page,
            testInfo.project.name,
            target.path,
            smokeFixtures,
          );
          await expectNoPageOverflow(page);
        }
      } finally {
        await cleanupFloorPlanSmokeFixtures(page, smokeFixtures);
      }
    });
  }
});
