import { expect, test } from "playwright/test";

test.setTimeout(120_000);

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
    {
      id: "trail-east", label: "Trail East", anchor: { lng: 103.859, lat: 1.2862 },
      events: [{
        id: "island-art-trail", title: "Island Art Trail", dateText: "20 Jul 2026", venue: "Trail East",
        venueOccurrences: [
          { venueOccurrenceId: "trail-east", publishedVenueName: "Trail East" },
          { venueOccurrenceId: "trail-west", publishedVenueName: "Trail West" },
        ],
      }],
    },
    {
      id: "trail-west", label: "Trail West", anchor: { lng: 103.8568, lat: 1.2854 },
      events: [{
        id: "island-art-trail", title: "Island Art Trail", dateText: "20 Jul 2026", venue: "Trail West",
        venueOccurrences: [
          { venueOccurrenceId: "trail-east", publishedVenueName: "Trail East" },
          { venueOccurrenceId: "trail-west", publishedVenueName: "Trail West" },
        ],
      }],
    },
  ],
  backgroundTilesetUrl: "poi-tiles/wisma-geylang-serai/tileset.json",
  poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
  offMapEvents: [
    { id: "secret-supper", title: "Secret Supper", venue: "Location TBA", publicPlacement: "off_map", mappingStatus: "not_required", lifecycleState: "active", offMapSubtype: "secret_tba", schedule: { kind: "anytime", displayText: "Anytime" } },
    { id: "studio-trail", title: "Studio Trail", venue: "Various venues", publicPlacement: "off_map", mappingStatus: "not_required", lifecycleState: "active", offMapSubtype: "multiple_locations", freshness: "stale", schedule: { kind: "selectable", displayText: "Select a date" } },
    { id: "cycling-route", title: "Cycling Route", venue: "Marina Bay route", publicPlacement: "off_map", mappingStatus: "not_required", lifecycleState: "active", offMapSubtype: "mobile_route", schedule: { kind: "exact", start: "2026-07-19T08:00:00+08:00", displayText: "19 July 2026" } },
    { id: "park-picnic", title: "Park Picnic", venue: "East Coast Park", publicPlacement: "off_map", mappingStatus: "not_required", lifecycleState: "active", offMapSubtype: "broad_area", schedule: { kind: "anytime", displayText: "Anytime" } },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((snapshot) => { globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot; }, fixture);
});

test("the map starts directly without a startup surface", async ({ page }) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  await expect(page.locator("#warning")).toHaveCount(0);
  await expect.poll(() => page.locator("body").getAttribute("data-buildings-layer-started")).toBe("true");
  await expect(page.locator("#landmark-event-search")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Map information and attribution" }),
  ).toBeVisible();
  await page.evaluate(() => window._map?.remove()).catch(() => {});
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
  await page.evaluate(() => window._map?.remove()).catch(() => {});
});

test("a multi-location activity is labelled at each mapped venue", async ({ page }) => {
  await page.goto("/?autoStart#17/1.2858/103.8579/0/60");
  await expect(page.locator("#trail-east-event-pill .landmark-event-pill__location")).toHaveText("Multiple locations");
  await expect(page.locator("#trail-west-event-pill .landmark-event-pill__location")).toHaveText("Multiple locations");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?autoStart&emptyApprovedSnapshot#17/1.2858/103.8579/0/60");
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

test("only the secret-location filter remains and location types move into activity details", async ({ page }) => {
  await page.goto("/?autoStart#17/1.2858/103.8579/0/60");
  const search = page.locator("#landmark-event-search-input");
  await search.focus();
  await expect(page.getByRole("button", { name: "Mystery Location" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mapped", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Multiple locations" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mystery Location" }).click();
  const secret = page.getByRole("option", { name: /Secret Supper/ });
  await expect(secret).toContainText("Anytime");
  const centerBefore = await page.evaluate(() => window._map.getCenter().toArray());
  await secret.click();
  await expect(page.locator("#landmark-event-panel")).toBeVisible();
  await expect(page.locator(".landmark-event-panel__field--locationType")).toContainText("Mystery Location");
  expect(await page.evaluate(() => window._map.getCenter().toArray())).toEqual(centerBefore);
  await page.getByRole("button", { name: "Back to events" }).click();
  await expect(page.locator("#landmark-event-panel")).toBeHidden();

  await search.focus();
  await page.getByRole("button", { name: "Mystery Location" }).click();
  const multiple = page.getByRole("option", { name: /Studio Trail/ });
  await expect(multiple).toContainText("May be outdated");
  await expect(multiple).toContainText("Multiple locations");

  await multiple.click();
  await expect(page.locator(".landmark-event-panel__field--locationType")).toContainText("Multiple locations");
  await page.evaluate(() => window._map.remove());
});
