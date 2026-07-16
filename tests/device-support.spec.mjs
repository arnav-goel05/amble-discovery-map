import { expect, test } from "playwright/test";

test("phones stop before the 3D application loads while larger screens continue", async ({ page }, testInfo) => {
  const mobileProject = testInfo.project.name.endsWith("-mobile");
  await page.goto("/?autoStart");

  if (mobileProject) {
    await expect(page.locator("body")).toHaveAttribute("data-device-support", "unsupported");
    await expect(page.getByRole("heading", { name: "Singapore is waiting on the big screen" })).toBeVisible();
    await expect(page.locator("#device-gate")).toBeVisible();
    await expect(page.locator("#map")).toHaveCount(0);
    await expect(page.locator("#experience-intro")).toHaveCount(0);
    expect(await page.evaluate(() => ({
      mapCreated: Boolean(window._map),
      mapLibreRequested: performance.getEntriesByType("resource").some(({ name }) => /maplibre|main-[^/]+\.js/.test(name)),
    }))).toEqual({ mapCreated: false, mapLibreRequested: false });
    return;
  }

  await expect(page.locator("body")).toHaveAttribute("data-device-support", "supported");
  await expect(page.locator("#device-gate")).toHaveCount(0);
  await expect(page.locator("#map")).toHaveCount(1);
  await page.evaluate(() => window._map?.remove());
});
