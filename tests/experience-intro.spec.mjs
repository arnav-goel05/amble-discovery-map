import { expect, test } from "playwright/test";

test("the intro waits for initial 3D content and fades away on entry", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } = await import("/activity-scenes/experience-intro.js");
    window.__introEnterCount = 0;
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      minimumDisplayMs: 0,
      readySettleMs: 40,
      onEnter: () => { window.__introEnterCount += 1; },
    });
  });

  const intro = page.locator("#experience-intro");
  await expect(intro).toBeVisible();
  await expect(page.locator(".experience-intro__wordmark")).toBeVisible();
  await expect(page.locator(".experience-intro__wordmark")).toHaveAttribute("src", "/brand/amble-wordmark.png");
  await expect(page.getByRole("heading", { name: "There is too much happening in Singapore, you just didn't know it" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Let's explore" })).toBeHidden();

  await page.evaluate(() => {
    Object.assign(document.body.dataset, {
      mapLoaded: "true",
      buildingsLayerStarted: "true",
      tilesetLoaded: "true",
      backgroundViewLoaded: "true",
    });
  });

  const enter = page.getByRole("button", { name: "Let's explore" });
  await expect(enter).toBeVisible();
  await expect(page.getByText("Bringing Singapore into view")).toBeHidden();
  await expect(enter).not.toBeFocused();
  await expect(page.locator("body")).toHaveAttribute("data-experience-intro", "ready");
  await enter.click();
  expect(await page.evaluate(() => window.__introEnterCount)).toBe(1);
  await expect(intro).toHaveClass(/is-leaving/);
  await expect(intro).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator("body")).toHaveAttribute("data-experience-intro", "complete");
});

test("the ready state must remain stable before entry is offered", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } = await import("/activity-scenes/experience-intro.js");
    window.__sceneReady = false;
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      minimumDisplayMs: 0,
      readySettleMs: 100,
      sceneReady: () => window.__sceneReady,
    });
  });
  const enter = page.getByRole("button", { name: "Let's explore" });
  await page.evaluate(() => { window.__sceneReady = true; });
  await page.waitForTimeout(60);
  await page.evaluate(() => { window.__sceneReady = false; });
  await expect(enter).toBeHidden();
  await page.evaluate(() => { window.__sceneReady = true; });
  await expect(enter).toBeVisible();
});

test("auto-start can bypass the first-load experience", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createExperienceIntro } = await import("/activity-scenes/experience-intro.js");
    createExperienceIntro({ skip: true });
    return document.body.dataset.experienceIntro;
  });
  expect(state).toBe("skipped");
  await expect(page.locator("#experience-intro")).toHaveCount(0);
});
