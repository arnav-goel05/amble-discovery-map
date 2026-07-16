import { expect, test } from "playwright/test";

const fixture = {
  pois: [],
  landmarks: [
    {
      id: "fixture-hall", label: "Fixture Hall", anchor: { lng: 103.8579, lat: 1.2858 },
      events: [
        { id: "fixture:1", title: "A Complete Event Title That Must Never Be Truncated", dateText: "14 Jul 2026", venue: "Fixture Hall" },
        { id: "fixture:2", title: "Second Upcoming Event", dateText: "15 Jul 2026", venue: "Fixture Hall" },
      ],
    },
  ],
  backgroundTilesetUrl: "optimized-tiles/tileset.json",
  poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((snapshot) => { globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot; }, fixture);
});

test("the map starts directly without a startup surface", async ({ page }) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  await expect(page.locator("#warning")).toHaveCount(0);
  await expect.poll(() => page.locator("body").getAttribute("data-buildings-layer-started")).toBe("true");
  await expect(page.locator("#landmark-event-search")).toBeVisible();
  await page.evaluate(() => window._map.remove());
});

test("anonymous startup renders one compact full-title pill and tracks its map anchor", async ({ page }) => {
  await page.goto("/?autoStart#17/1.2858/103.8579/0/60");
  const pill = page.locator("#fixture-hall-event-pill");
  await expect(pill).toHaveCount(1);
  await expect(pill.locator(".landmark-event-pill__title")).toHaveText("A Complete Event Title That Must Never Be Truncated");
  const before = await page.locator("body").getAttribute("data-landmark-event-pill-position-pass-count");
  await page.evaluate(() => window._map.fire("move"));
  await expect.poll(async () => Number(await page.locator("body").getAttribute("data-landmark-event-pill-position-pass-count"))).toBeGreaterThan(Number(before));
  await expect(page.locator("#landmark-event-panel")).toBeHidden();
  await page.evaluate(() => window._map.remove());
});

test("multiple events share one landmark pill and one singleton detail panel", async ({ page }) => {
  await page.goto("/?autoStart#17/1.2858/103.8579/0/60");
  await page.locator("#fixture-hall-event-pill .landmark-event-pill__card").click();
  const panel = page.locator("#landmark-event-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".landmark-event-panel__event-position")).toContainText("of 2");
  await expect(page.locator("#landmark-event-panel")).toHaveCount(1);
  await page.evaluate(() => window._map.remove());
});

test("empty snapshots keep the mobile toolbar compact and hide laptop-only map controls", async ({ page }) => {
  await page.goto("/?autoStart&emptyApprovedSnapshot#17/1.2858/103.8579/0/60");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-search")).toBeVisible();
  await expect(page.locator(".landmark-event-search__actions > button")).toHaveCount(2);
  await expect(page.locator("#map-guidance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show feature tour" })).toBeVisible();
  for (const name of ["Zoom in", "Zoom out", "Rotate map"]) await expect(page.getByRole("button", { name })).toBeHidden();
  const mobileToolbar = await page.evaluate(() => {
    const toolbar = document.getElementById("landmark-event-search").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".landmark-event-search__category, .landmark-event-search__actions > button")]
      .map((button) => button.getBoundingClientRect());
    const dateFilter = document.querySelector(".landmark-event-search__filters").getBoundingClientRect();
    return {
      bottom: toolbar.bottom,
      dateTop: dateFilter.top,
      height: toolbar.height,
      iconTop: Math.min(...buttons.map(({ top }) => top)),
      left: toolbar.left,
      right: toolbar.right,
      rowSpread: Math.max(...buttons.map(({ top }) => top)) - Math.min(...buttons.map(({ top }) => top)),
    };
  });
  expect(mobileToolbar.left).toBeGreaterThanOrEqual(8);
  expect(mobileToolbar.right).toBeLessThanOrEqual(382);
  expect(mobileToolbar.height).toBeLessThanOrEqual(160);
  expect(mobileToolbar.bottom).toBeLessThanOrEqual(172);
  expect(mobileToolbar.rowSpread).toBeLessThanOrEqual(1);
  expect(mobileToolbar.dateTop).toBeLessThan(mobileToolbar.iconTop);
  await expect(page.locator(".landmark-event-search__filters")).toHaveCSS("border-left-width", "0px");
  await expect(page.locator(".landmark-event-search__filters")).toHaveCSS("border-right-width", "0px");

  const expandedHeight = mobileToolbar.height;
  const transitionDurations = await page.evaluate(() => ({
    controls: getComputedStyle(document.querySelector(".landmark-event-search__controls")).transitionDuration,
    toolbar: getComputedStyle(document.getElementById("landmark-event-search")).transitionDuration,
  }));
  expect(transitionDurations.controls).not.toBe("0s");
  expect(transitionDurations.toolbar).not.toBe("0s");
  await expect(page.getByRole("button", { name: /Collapse search controls|Expand search controls/ })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:overlay-open", { detail: { id: "restaurants" } })));
  await expect(page.locator("#landmark-event-search")).toHaveClass(/is-collapsed/);
  await expect(page.locator(".landmark-event-search__controls")).toBeHidden();
  await expect(page.locator(".landmark-event-search__collapsed-indicator")).toBeVisible();
  const collapsedHeight = await page.locator("#landmark-event-search").evaluate((node) => node.getBoundingClientRect().height);
  expect(collapsedHeight).toBeLessThan(expandedHeight);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:overlay-close", { detail: { id: "restaurants" } })));
  await expect(page.locator("#landmark-event-search")).not.toHaveClass(/is-collapsed/);
  await expect(page.locator(".landmark-event-search__controls")).toBeVisible();
  await page.evaluate(() => window._map.remove());
});
