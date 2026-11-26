import { test, expect } from "@playwright/test";

test("home page shows the demo and the language list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Try it with your own voice/ })).toBeVisible();
  await expect(page.getByText("Coming soon").first()).toBeVisible();
});

test("Get Started opens the create-account form and Sign In opens sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Get Started/ }).click();
  await expect(page).toHaveURL(/\/auth\?mode=up/);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Sign In" }).first().click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("live demo starts listening and shows the microphone meter", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const start = page.getByRole("button", { name: /Try the live demo/ });
  await start.scrollIntoViewIfNeeded();
  await start.click();
  await expect(page.getByText(/Listening\. Start speaking|Hearing you/)).toBeVisible();
  await page.getByRole("button", { name: /Stop/ }).click();
});

test("the demo's language options are limited to French and Spanish", async ({ page }) => {
  await page.goto("/");
  const language = page.getByRole("combobox", { name: /Translate into/ });
  await language.scrollIntoViewIfNeeded();
  await expect(language.locator("option")).toHaveText(["🇫🇷 Français", "🇪🇸 Español"]);
});
