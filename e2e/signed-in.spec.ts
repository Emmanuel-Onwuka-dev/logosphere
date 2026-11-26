import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const email = process.env["E2E_EMAIL"];
const password = process.env["E2E_PASSWORD"];
test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run signed-in tests");

const title = `E2E sermon ${Date.now()}`;

async function signIn(page: Page) {
  await page.goto("/auth");
  // Wait for the app to load its scripts; submitting earlier falls back to a plain form post.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("dashboard shows the ministry workspace and navigation", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  for (const label of ["Recorded Sermons", "Sermon Library", "Evangelism & Outreach", "Language Settings", "Usage & Activity", "Profile", "Organisation"]) {
    await expect(page.getByRole("link", { name: label }).first()).toBeVisible();
  }
});

test("profile saves the name", async ({ page }) => {
  await signIn(page);
  await page.goto("/profile");
  const name = page.getByLabel("Name");
  await name.fill(`E2E ${Date.now() % 1000}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
});

test("upload a sermon, see its transcript, then archive and delete it", async ({ page }) => {
  await signIn(page);
  await page.goto("/recordings");
  await page.getByLabel("Sermon title").fill(title);
  await page.getByLabel(/Audio file/).setInputFiles(fileURLToPath(new URL("./fixtures/sermon.wav", import.meta.url)));
  await page.getByRole("button", { name: "Upload and transcribe" }).click();
  // Transcription can take a minute; the page opens on the sermon when it is ready.
  await expect(page).toHaveURL(/\/recordings\/[0-9a-f-]{36}$/, { timeout: 240_000 });
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
  await page.getByLabel("Filter sermons").selectOption("archived");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});
