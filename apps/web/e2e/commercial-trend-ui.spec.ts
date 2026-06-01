import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.RBAC_E2E_BASE_URL ?? "http://127.0.0.1:3251";
const operator = {
  email: process.env.RBAC_E2E_OPERATOR_EMAIL ?? "operator@example.local",
  password: process.env.RBAC_E2E_OPERATOR_PASSWORD ?? "DemoPass123!"
};
const axisMarker = "NMTH_TREND_AXIS_TEMP_0_35_5_HUMIDITY_0_70_10";

async function login(page: Page) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/login", {
    data: { email: operator.email, password: operator.password }
  });
  expect(response.ok(), `${operator.email} should login before trend checks`).toBe(true);
  const sessionToken = response.headers()["set-cookie"]?.match(/nmth_session=([^;]+)/)?.[1];
  expect(sessionToken, `${operator.email} login should set nmth_session cookie`).toBeTruthy();
  await page.context().addCookies([
    {
      name: "nmth_session",
      value: sessionToken!,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
}

async function selectReportDevices(page: Page): Promise<string[]> {
  const deviceField = page.locator(".ant-form-item").filter({ hasText: "機器名稱" }).first();
  await deviceField.locator(".ant-select-selector").click();
  const options = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content");
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).slice(0, 2);
  expect(labels.length, "report smoke needs at least one selectable device").toBeGreaterThan(0);
  for (const label of labels) {
    await page.getByTitle(label).click();
  }
  await page.keyboard.press("Escape");
  return labels;
}

async function expectQuickRangeLayout(page: Page) {
  const labels = page.locator('[data-testid^="reports-quick-range-label-"]');
  await expect(labels).toHaveCount(3);
  const metrics = await labels.evaluateAll((elements) =>
    elements.map((element) => {
      const label = element as HTMLElement;
      const item = label.closest(".ant-segmented-item") as HTMLElement | null;
      return {
        text: label.innerText,
        labelWidth: label.getBoundingClientRect().width,
        labelScrollWidth: label.scrollWidth,
        itemWidth: item?.getBoundingClientRect().width ?? 0
      };
    })
  );
  for (const metric of metrics) {
    expect(metric.labelScrollWidth, `${metric.text} should not be clipped`).toBeLessThanOrEqual(metric.labelWidth + 1);
  }
  const itemWidths = metrics.map((metric) => metric.itemWidth);
  expect(Math.max(...itemWidths) - Math.min(...itemWidths), "quick range options should have equal visual width").toBeLessThanOrEqual(1.5);
}

async function expectSearchAlignedWithSampling(page: Page) {
  const metrics = await page.evaluate(() => {
    const interval = document.querySelector('[data-testid="reports-interval-field"] .ant-select-selector');
    const button = document.querySelector('[data-testid="reports-search-submit"]');
    const intervalBox = interval?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    return intervalBox && buttonBox
      ? {
          intervalBottom: intervalBox.bottom,
          buttonBottom: buttonBox.bottom
        }
      : null;
  });
  expect(metrics, "sampling select and search button should be measurable").toBeTruthy();
  expect(Math.abs(metrics!.buttonBottom - metrics!.intervalBottom)).toBeLessThanOrEqual(2);
}

async function expectReportTooltipUsesHumiditySetpoint(page: Page) {
  const canvas = page.locator('[data-testid="reports-trend-chart-card"] canvas').first();
  const box = await canvas.boundingBox();
  expect(box, "report trend chart canvas should be measurable").toBeTruthy();
  const positions = [
    { x: 0.5, y: 0.42 },
    { x: 0.35, y: 0.5 },
    { x: 0.7, y: 0.38 }
  ];
  for (const position of positions) {
    await page.mouse.move(box!.x + box!.width * position.x, box!.y + box!.height * position.y);
    const found = await page
      .waitForFunction(
        () =>
          Array.from(document.body.querySelectorAll("div")).some((element) => {
            const node = element as HTMLElement;
            const style = window.getComputedStyle(node);
            return node.textContent?.includes("濕度設定值") && style.position === "absolute" && Number(style.zIndex) >= 1000;
          }),
        undefined,
        { timeout: 1500 }
      )
      .then(() => true)
      .catch(() => false);
    if (found) return;
  }
  throw new Error("report chart tooltip did not show 濕度設定值");
}

type PdfTextItem = {
  page: number;
  text: string;
  x: number;
  y: number;
};

async function extractPdfTextItems(file: Buffer): Promise<PdfTextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(file), useSystemFonts: true }).promise;
  const items: PdfTextItem[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (typeof item !== "object" || !item || !("str" in item)) {
        continue;
      }
      const transform = "transform" in item && Array.isArray((item as { transform: unknown }).transform) ? (item as { transform: number[] }).transform : [];
      items.push({
        page: pageNumber,
        text: String((item as { str: unknown }).str),
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0)
      });
    }
  }
  await pdf.destroy();
  return items;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "");
}

function findPdfTextItem(items: PdfTextItem[], value: string): PdfTextItem | undefined {
  const needle = compactText(value);
  return items.find((item) => compactText(item.text).includes(needle));
}

test.describe("commercial trend UI behavior", () => {
  test("does not query reports on initial load and blocks no-device search", async ({ page }) => {
    await login(page);
    const reportRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/measurements/report")) {
        reportRequests.push(request.url());
      }
    });

    await page.goto("/zh-TW/reports");
    await expect(page.getByRole("menuitem", { name: "圖表與報表" })).toBeVisible();
    await expect(page.locator(".nmth-section-title small")).toHaveText("Climate trend and export");
    await expect(page.getByRole("heading", { name: "圖表與報表" })).toBeVisible();
    await expect(page.locator('[data-testid="reports-trend-chart-card"]')).toContainText("曲線圖");
    await expectQuickRangeLayout(page);
    await expectSearchAlignedWithSampling(page);
    await expect(page.getByRole("button", { name: "搜尋" })).toBeDisabled();
    await expect(page.getByText("請先選擇設備").first()).toBeVisible();
    expect(reportRequests).toEqual([]);
  });

  test("queries only after device selection, renders chart, and downloads PDF", async ({ page }) => {
    await login(page);
    await page.goto("/zh-TW/reports");
    const selectedDeviceLabels = await selectReportDevices(page);

    await expect(page.getByRole("button", { name: "搜尋" })).toBeEnabled();
    await page.getByRole("button", { name: "搜尋" }).click();
    await expect(page.locator('[data-testid="reports-trend-chart-card"] canvas').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[aria-label="${axisMarker}"]`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("columnheader", { name: "濕度設定值" }).first()).toBeVisible({ timeout: 20_000 });
    await expectReportTooltipUsesHumiditySetpoint(page);

    await expect(page.getByRole("button", { name: "PDF" })).toBeEnabled({ timeout: 20_000 });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF" }).click()
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const file = await readFile(downloadPath!);
    expect(file.subarray(0, 4).toString()).toBe("%PDF");
    expect(file.byteLength).toBeGreaterThan(8000);
    const pdfItems = await extractPdfTextItems(file);
    const pdfText = compactText(pdfItems.map((item) => item.text).join(" "));
    expect(pdfText).toContain("圖表與報表");
    expect(pdfText).toContain("曲線圖");
    expect(pdfText).toContain("濕度設定值");
    expect(pdfText).toContain("機器");
    const selectedDeviceCodes = selectedDeviceLabels.map((label) => label.match(/\b\d{5}\b/)?.[0]).filter((value): value is string => Boolean(value));
    expect(selectedDeviceCodes.length, "selected device labels should include machine codes").toBeGreaterThan(0);
    expect(selectedDeviceCodes.some((code) => pdfText.includes(compactText(`機器 ${code}`)))).toBe(true);
    expect(pdfText).not.toContain("|");
    expect(pdfText).not.toContain("real|REAL");
    expect(pdfText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    const chartTitle = findPdfTextItem(pdfItems, "曲線圖");
    const metadataTitle = findPdfTextItem(pdfItems, "報表標題");
    const dataListTitle = findPdfTextItem(pdfItems, "資料清單");
    expect(chartTitle, "PDF chart title should be extractable for layout checks").toBeTruthy();
    expect(metadataTitle, "PDF metadata should start below the fixed chart block").toBeTruthy();
    expect(dataListTitle, "PDF data list title should be extractable for layout checks").toBeTruthy();
    expect(chartTitle!.page).toBe(metadataTitle!.page);
    expect(chartTitle!.y - metadataTitle!.y, "metadata text should be below the chart image block, not over it").toBeGreaterThan(180);
    expect(metadataTitle!.y - dataListTitle!.y, "data list should be below report metadata").toBeGreaterThan(40);
  });

  test("dashboard trend chart renders with the shared fixed axis marker", async ({ page }) => {
    await login(page);
    await page.goto("/zh-TW/dashboard");
    await expect(page.getByRole("heading", { name: "即時儀表板" })).toBeVisible();
    await page.getByRole("tab", { name: "圖表與報表" }).last().click();
    await expect(page.getByText("曲線圖").last()).toBeVisible();
    await expect(page.locator("canvas").last()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[aria-label="${axisMarker}"]`).last()).toBeVisible({ timeout: 20_000 });
  });
});
