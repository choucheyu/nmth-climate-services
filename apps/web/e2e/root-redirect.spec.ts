import { expect, test, type Page } from "@playwright/test";

const baseUrl = process.env.RBAC_E2E_BASE_URL ?? "http://127.0.0.1:3251";

const operator = {
  email: process.env.RBAC_E2E_OPERATOR_EMAIL ?? "operator@example.local",
  password: process.env.RBAC_E2E_OPERATOR_PASSWORD ?? "DemoPass123!",
};

async function login(page: Page) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/auth/login", {
    data: operator,
  });
  expect(response.ok(), `${operator.email} should login before root redirect checks`).toBe(true);
  const sessionToken = response.headers()["set-cookie"]?.match(/nmth_session=([^;]+)/)?.[1];
  expect(sessionToken, `${operator.email} login should set nmth_session cookie`).toBeTruthy();
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

test.describe("root route session redirects", () => {
  test("unauthenticated root goes straight to localized login", async ({ page }) => {
    await page.context().clearCookies();

    const response = await page.request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/zh-TW/login");

    await page.goto("/");
    await expect(page).toHaveURL(/\/zh-TW\/login$/);
    await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  });

  test("authenticated root goes straight to localized dashboard", async ({ page }) => {
    await login(page);

    const response = await page.request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/zh-TW/dashboard");

    await page.goto("/");
    await expect(page).toHaveURL(/\/zh-TW\/dashboard$/);
    await expect(page.getByRole("heading", { name: "即時儀表板" })).toBeVisible();
  });
});
