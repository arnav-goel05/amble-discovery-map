import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div class="maplibregl-canvas"></div>
      <section class="landmark-event-pill"><button class="landmark-event-pill__card">Event</button></section>
      <input id="landmark-event-search-input">
      <div class="landmark-event-search__categories"><button>Category</button></div>
      <div class="landmark-event-search__filter--dateRange"><button>Date</button></div>
      <button id="restaurant-search-button">Restaurants</button>
      <button id="plan-builder-button">Plan</button>
      <div id="map-guidance"><button>Map</button></div>`;
  });
});

test("walks through every primary feature and remembers completion", async ({ page }) => {
  await page.evaluate(async () => {
    const { createFeatureTour } = await import("/activity-scenes/feature-tour.js");
    window.__featureTour = createFeatureTour();
    window.__featureTour.start();
  });

  const tour = page.locator("#feature-tour");
  await expect(tour).toBeVisible();
  await expect(page.getByRole("heading", { name: "Events live on the map" })).toBeVisible();
  await expect(tour).toContainText("1 of 7");

  const next = page.getByRole("button", { name: /Next/ });
  for (const title of [
    "Search what’s nearby", "Explore by category", "Choose when to go",
    "Find food nearby", "Build your day out", "Make the map yours",
  ]) {
    await next.click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByRole("button", { name: /Start exploring/ }).click();
  await expect(tour).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-feature-tour", "complete");
  expect(await page.evaluate(() => window.__featureTour.start())).toBe(false);
});

test("supports back, escape, skip, and a forced replay", async ({ page }) => {
  await page.evaluate(async () => {
    const { createFeatureTour } = await import("/activity-scenes/feature-tour.js");
    window.__featureTour = createFeatureTour();
    window.__featureTour.start();
  });
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page.getByRole("heading", { name: "Events live on the map" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#feature-tour")).toBeHidden();
  expect(await page.evaluate(() => window.__featureTour.start({ force: true }))).toBe(true);
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator("#feature-tour")).toBeHidden();
});
