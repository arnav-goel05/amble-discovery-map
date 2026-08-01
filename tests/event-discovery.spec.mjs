import { expect, test } from "playwright/test";

test.setTimeout(120_000);

const fixture = {
  pois: [],
  landmarks: [
    {
      id: "fixture-hall",
      label: "Fixture Hall",
      anchor: { lng: 103.8579, lat: 1.2858 },
      events: [
        {
          id: "fixture:1",
          title: "A Complete Event Title That Must Never Be Truncated",
          dateText: "14 Jul 2026",
          venue: "Fixture Hall",
          category: "Performances",
        },
        {
          id: "fixture:2",
          title: "Second Upcoming Event",
          dateText: "15 Jul 2026",
          venue: "Fixture Hall",
          category: "Exhibitions",
        },
      ],
    },
    {
      id: "trail-east",
      label: "Trail East",
      anchor: { lng: 103.859, lat: 1.2862 },
      events: [
        {
          id: "island-art-trail",
          title: "Island Art Trail",
          dateText: "20 Jul 2026",
          venue: "Trail East",
          category: "Tours & Experiences",
          venueOccurrences: [
            {
              venueOccurrenceId: "trail-east",
              publishedVenueName: "Trail East",
            },
            {
              venueOccurrenceId: "trail-west",
              publishedVenueName: "Trail West",
            },
          ],
        },
      ],
    },
    {
      id: "trail-west",
      label: "Trail West",
      anchor: { lng: 103.8568, lat: 1.2854 },
      events: [
        {
          id: "island-art-trail",
          title: "Island Art Trail",
          dateText: "20 Jul 2026",
          venue: "Trail West",
          category: "Tours & Experiences",
          venueOccurrences: [
            {
              venueOccurrenceId: "trail-east",
              publishedVenueName: "Trail East",
            },
            {
              venueOccurrenceId: "trail-west",
              publishedVenueName: "Trail West",
            },
          ],
        },
      ],
    },
  ],
  backgroundTilesetUrl: "poi-tiles/wisma-geylang-serai/tileset.json",
  poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
  offMapEvents: [
    {
      id: "secret-supper",
      title: "Secret Supper",
      venue: "Location TBA",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      lifecycleState: "active",
      offMapSubtype: "secret_tba",
      schedule: { kind: "anytime", displayText: "Anytime" },
    },
    {
      id: "studio-trail",
      title: "Studio Trail",
      venue: "Various venues",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      lifecycleState: "active",
      offMapSubtype: "multiple_locations",
      freshness: "stale",
      schedule: { kind: "selectable", displayText: "Select a date" },
    },
    {
      id: "cycling-route",
      title: "Cycling Route",
      venue: "Marina Bay route",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      lifecycleState: "active",
      offMapSubtype: "mobile_route",
      schedule: {
        kind: "exact",
        start: "2026-07-19T08:00:00+08:00",
        displayText: "19 July 2026",
      },
    },
    {
      id: "park-picnic",
      title: "Park Picnic",
      venue: "East Coast Park",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      lifecycleState: "active",
      offMapSubtype: "broad_area",
      schedule: { kind: "anytime", displayText: "Anytime" },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((snapshot) => {
    globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
  }, fixture);
});

async function chooseFilterOption(page, optionId) {
  const dimension = optionId.startsWith("landmark:")
    ? "where"
    : optionId.split(":")[0];
  await page.locator("#landmark-event-search-input").focus();
  await page.locator(`[data-filter-dimension="${dimension}"]`).click();
  if (optionId.startsWith("landmark:")) {
    const label = optionId
      .slice("landmark:".length)
      .split("-")
      .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
      .join(" ");
    await page.locator("#landmark-event-search-input").fill(label);
    await page.locator("#landmark-event-search-input").press("Enter");
    return;
  }
  await page.locator(`[data-filter-option-id="${optionId}"]`).click();
}

test("guided filters expose every dimension and apply a partial Where selection immediately", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await input.focus();
  const dimensions = page.locator("[data-filter-dimension]");
  await expect(dimensions).toHaveText([/What/, /When/, /Where/, /Price/]);
  await expect(
    page.locator(".landmark-event-search__option-group"),
  ).toHaveCount(1);
  await expect(
    page.locator(".landmark-event-search__option-group-heading"),
  ).toHaveText("What");

  const popoverBounds = await page
    .locator(".landmark-event-search__popover")
    .boundingBox();
  const searchBounds = await page
    .locator("#landmark-event-search")
    .boundingBox();
  const builderBounds = await page
    .locator(".landmark-event-search__builder")
    .boundingBox();
  expect(popoverBounds.width).toBeLessThanOrEqual(682);
  const viewport = await page.evaluate(() => ({
    area: innerWidth * innerHeight,
    width: innerWidth,
  }));
  if (viewport.width > 720) {
    expect(searchBounds.width).toBeLessThanOrEqual(982);
    expect(searchBounds.height).toBeLessThanOrEqual(74);
    expect(builderBounds.height).toBeLessThanOrEqual(62);
    expect(popoverBounds.width * popoverBounds.height).toBeLessThan(
      viewport.area / 2,
    );
  }

  await page.locator('[data-filter-dimension="where"]').click();
  await expect(
    page.locator(".landmark-event-search__option-group-heading"),
  ).toHaveText("Where");
  await expect(dimensions).toHaveCount(4);
  await expect(page.locator(".landmark-event-search__option")).toHaveText([
    "Near me",
    "Current map area",
    "Anywhere in Singapore",
    "Mystery Location",
  ]);
  await input.fill("Fixture Hall");
  await input.press("Enter");
  await expect(
    page.locator('[data-filter-token-id="landmark:fixture-hall"]'),
  ).toContainText("Fixture Hall");
  await expect(page.locator("#landmark-event-search-results")).toContainText(
    "Second Upcoming Event",
  );
  await expect(input).toHaveValue("");
  await expect(dimensions).toHaveCount(3);
  await expect(page.locator('[data-filter-dimension="where"]')).toHaveCount(0);

  await page.locator('[data-filter-token-id="landmark:fixture-hall"]').click();
  await page.getByRole("button", { name: "Remove selection" }).click();
  await expect(
    page.locator('[data-filter-token-id="landmark:fixture-hall"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-filter-dimension="where"]')).toBeVisible();
  await page.evaluate(() => window._map.remove());
});

test("guided filters remain reachable at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await input.focus();
  await expect(page.locator("[data-filter-dimension]")).toHaveCount(4);

  const compactPlacement = await page.evaluate(() => {
    const controls = document
      .querySelector(".landmark-event-search__controls")
      .getBoundingClientRect();
    const minimap = document
      .getElementById("event-density-minimap")
      .getBoundingClientRect();
    const overlapsAction = [
      ...document.querySelectorAll(".landmark-event-search__actions button"),
    ].some((button) => {
      const action = button.getBoundingClientRect();
      return !(
        minimap.right <= action.left ||
        minimap.left >= action.right ||
        minimap.bottom <= action.top ||
        minimap.top >= action.bottom
      );
    });
    return {
      gap: minimap.top - controls.bottom,
      minimapTop: minimap.top,
      overlapsAction,
      rightGap: innerWidth - minimap.right,
    };
  });
  expect(compactPlacement.gap).toBeGreaterThanOrEqual(0);
  expect(compactPlacement.gap).toBeLessThanOrEqual(16);
  expect(compactPlacement.minimapTop).toBeLessThan(144);
  expect(compactPlacement.overlapsAction).toBe(false);
  expect(compactPlacement.rightGap).toBeLessThanOrEqual(16);

  const popoverBounds = await page
    .locator(".landmark-event-search__popover")
    .boundingBox();
  expect(popoverBounds.x).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.x + popoverBounds.width).toBeLessThanOrEqual(320);

  await page.locator('[data-filter-dimension="what"]').click();
  const firstOption = page.locator('[data-filter-option-id^="what:"]').first();
  await expect(firstOption).toBeVisible();
  expect(
    await firstOption.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await firstOption.click();
  await expect(page.locator('[data-filter-token-id^="what:"]')).toBeVisible();
  await expect(input).toBeVisible();
  await page.evaluate(() => window._map.remove());
});

test("Current map area refreshes on movement and Near me uses one ephemeral location request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          requests += 1;
          document.body.dataset.testGeolocationRequests = String(requests);
          success({
            coords: {
              longitude: 103.8579,
              latitude: 1.2858,
              accuracy: 20,
            },
            timestamp: Date.now(),
          });
        },
      },
    });
  });
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await chooseFilterOption(page, "where:map-area");
  await expect(
    page.locator('[data-filter-token-id="where:map-area"]'),
  ).toBeVisible();
  await page.evaluate(() =>
    window._map.jumpTo({ center: [103.5, 1.1], zoom: 17 }),
  );
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "empty",
  );

  await input.fill("Near me");
  await page.locator('[data-filter-option-id="where:near-me"]').click();
  await expect(
    page.locator('[data-filter-token-id="where:near-me"]'),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-test-geolocation-requests",
    "1",
  );
  await expect(page.locator("#landmark-event-search-results")).toContainText(
    "Second Upcoming Event",
  );
  await page.evaluate(() => window._map.remove());
});

test("custom dates commit as one token and denied Near me preserves the previous Where filter", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success, failure) {
          failure({ code: 1 });
        },
      },
    });
  });
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await chooseFilterOption(page, "when:custom");
  await page.locator('[name="dateStart"]').fill("2026-07-14");
  await page.locator('[name="dateEnd"]').fill("2026-07-21");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.locator('[data-filter-token-id="when:custom"]'),
  ).toContainText("14 Jul – 21 Jul");

  await chooseFilterOption(page, "where:map-area");
  await input.fill("Near me");
  await page.locator('[data-filter-option-id="where:near-me"]').click();
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "permission-denied",
  );
  await expect(
    page.locator('[data-filter-token-id="where:map-area"]'),
  ).toBeVisible();
  await expect(page.locator(".landmark-event-search__status")).toContainText(
    "Location access was not granted",
  );
  await page.evaluate(() => window._map.remove());
});

test("recognized options support typing, replacement, Backspace, and wrapping", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await input.focus();
  await page.locator('[data-filter-dimension="what"]').click();
  await page.locator('[data-filter-option-id^="what:"]').first().click();
  await expect(page.locator('[data-filter-token-id^="what:"]')).toHaveCount(1);

  await input.fill("this weekend");
  await expect(
    page.locator('[data-filter-option-id="when:this-weekend"]'),
  ).toBeVisible();
  await input.press("Enter");
  await expect(
    page.locator('[data-filter-token-id="when:this-weekend"]'),
  ).toBeVisible();

  await input.fill("today");
  await input.press("Enter");
  await expect(
    page.locator('[data-filter-token-id="when:this-weekend"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-filter-token-id="when:today"]'),
  ).toBeVisible();

  await input.fill("");
  await chooseFilterOption(page, "price:free");
  await input.press("Backspace");
  await expect(page.locator('[data-filter-token-id="price:free"]')).toHaveCount(
    0,
  );
  await chooseFilterOption(page, "where:map-area");

  const filtersBeforeUnmatched = await page.evaluate(() =>
    Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
  );
  await input.fill("zzzz-no-option");
  await expect(
    page.locator(".landmark-event-search__no-options"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
    ),
  ).toBe(filtersBeforeUnmatched);
  await input.press("Escape");
  await expect(page.locator(".landmark-event-search__popover")).toBeHidden();

  const layout = await page.evaluate(() => ({
    builderHeight: document
      .querySelector(".landmark-event-search__builder")
      .getBoundingClientRect().height,
    mobile: innerWidth <= 720,
    tokenHeights: [
      ...document.querySelectorAll(".landmark-event-search__token"),
    ].map((node) => node.getBoundingClientRect().height),
  }));
  if (layout.mobile) {
    expect(layout.builderHeight).toBeGreaterThan(44);
    expect(layout.tokenHeights.every((height) => height >= 44)).toBe(true);
  }
  await page.evaluate(() => window._map.remove());
});

test("zero-result filters offer exact removal recovery and a clear-all fallback", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const input = page.locator("#landmark-event-search-input");
  await chooseFilterOption(page, "when:today");
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "empty",
  );
  const removeToday = page
    .locator(".landmark-event-search__recovery button")
    .filter({ hasText: "Remove Today" });
  await expect(removeToday).toBeVisible();
  const restoredCount = Number(
    (await removeToday.textContent()).split("·").at(-1),
  );
  expect(restoredCount).toBeGreaterThan(0);
  await removeToday.click();
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(
    page.locator(".landmark-event-search__results-count"),
  ).toHaveText(`${restoredCount} found`);

  await chooseFilterOption(page, "when:today");
  await chooseFilterOption(page, "price:free");
  const clearAll = page.getByRole("button", { name: "Clear all filters" });
  await expect(clearAll).toBeVisible();
  await clearAll.click();
  await expect(page.locator(".landmark-event-search__token")).toHaveCount(0);
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.evaluate(() => window._map.remove());
});

test("map movement reuses discovery while filter changes rebuild it", async ({
  page,
}) => {
  await page.goto(
    "/?performanceDiagnostics=1&performanceVariant=full#17/1.2858/103.8579/0/60",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
      ),
    )
    .toBeGreaterThan(0);

  const filtersBeforeSearch = await page.evaluate(() =>
    Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
  );
  await page.locator("#landmark-event-search-input").focus();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
      ),
    )
    .toBeGreaterThan(filtersBeforeSearch);
  const beforeMove = await page.evaluate(() => ({
    filters: Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
    refreshes: Number(
      document.body.dataset.eventSearchMoveEndRefreshCount ?? 0,
    ),
  }));
  await page.evaluate(() => window._map.fire("moveend"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.body.dataset.eventSearchMoveEndRefreshCount ?? 0),
      ),
    )
    .toBeGreaterThan(beforeMove.refreshes);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
      ),
    )
    .toBe(beforeMove.filters);

  await chooseFilterOption(page, "landmark:fixture-hall");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(document.body.dataset.eventDiscoveryFilterCount ?? 0),
      ),
    )
    .toBeGreaterThan(beforeMove.filters);
  await expect(page.locator("#landmark-event-search-results")).toContainText(
    "Second Upcoming Event",
  );
  await page.evaluate(() => window._map.remove());
});

test("guided option narrowing and bounded recovery stay within the local response target", async ({
  page,
}) => {
  await page.goto(
    "/?performanceDiagnostics=1&performanceVariant=full#17/1.2858/103.8579/0/60",
  );
  await page.locator("#landmark-event-search-input").focus();
  const narrowingDuration = await page.evaluate(() => {
    const input = document.getElementById("landmark-event-search-input");
    const startedAt = performance.now();
    input.value = "week";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return performance.now() - startedAt;
  });
  expect(narrowingDuration).toBeLessThan(200);
  await page.locator("#landmark-event-search-input").fill("");
  await chooseFilterOption(page, "when:today");
  await expect(page.locator("#landmark-event-search")).toHaveAttribute(
    "data-state",
    "empty",
  );
  expect(
    await page.evaluate(() =>
      Number(document.body.dataset.eventDiscoveryFilterDurationMs),
    ),
  ).toBeLessThan(200);
  await page.evaluate(() => window._map.remove());
});

test("the map starts directly without a startup surface", async ({ page }) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  await expect(page.locator("#warning")).toHaveCount(0);
  await expect
    .poll(
      () => page.locator("body").getAttribute("data-buildings-layer-started"),
      { timeout: 15_000 },
    )
    .toBe("true");
  await expect(page.locator("#landmark-event-search")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Map information and attribution" }),
  ).toBeVisible();
  await page.evaluate(() => window._map?.remove()).catch(() => {});
});

test("the pixel minimap moves the map and follows event filters", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const minimap = page.locator("#event-density-minimap");
  await expect(minimap).toBeVisible();
  await expect(page.locator(".event-density-minimap__status")).toHaveCount(0);
  await expect(minimap).toHaveCSS("pointer-events", "auto");
  await expect(minimap).toHaveAttribute("role", "button");
  await expect(minimap).toHaveAttribute("data-activity-count", "3");
  await expect(minimap).toHaveAttribute("data-viewport-visible", "true");
  const closeViewportWidth = Number(
    await minimap.getAttribute("data-viewport-width"),
  );
  const placement = await page.evaluate(() => {
    const toolbar = document
      .getElementById("landmark-event-search")
      .getBoundingClientRect();
    const minimapBounds = document
      .getElementById("event-density-minimap")
      .getBoundingClientRect();
    const brand = document.getElementById("map-brand");
    const brandBounds = brand.getBoundingClientRect();
    return {
      brandGapFromToolbar: toolbar.left - brandBounds.right,
      brandLoaded:
        brand.querySelector("img").complete &&
        brand.querySelector("img").naturalWidth > 0,
      brandVisible: getComputedStyle(brand).display !== "none",
      brandTopDifference: Math.abs(brandBounds.top - toolbar.top),
      gapFromToolbar: minimapBounds.left - toolbar.right,
      insideViewport:
        minimapBounds.left >= 0 && minimapBounds.right <= window.innerWidth,
      topDifference: Math.abs(minimapBounds.top - toolbar.top),
      viewportWidth: window.innerWidth,
    };
  });
  expect(placement.brandLoaded).toBe(true);
  expect(placement.insideViewport).toBe(true);
  if (placement.viewportWidth > 960) {
    expect(placement.brandVisible).toBe(true);
    expect(placement.brandGapFromToolbar).toBeGreaterThanOrEqual(12);
    expect(placement.brandTopDifference).toBeLessThanOrEqual(2);
    expect(placement.gapFromToolbar).toBeGreaterThanOrEqual(12);
    expect(placement.topDifference).toBeLessThanOrEqual(2);
  } else expect(placement.brandVisible).toBe(false);
  const centerBeforeClick = await page.evaluate(() =>
    window._map.getCenter().toArray(),
  );
  await minimap.click({ position: { x: 36, y: 36 } });
  await expect
    .poll(async () => {
      const center = await page.evaluate(() => window._map.getCenter());
      return Math.hypot(
        center.lng - centerBeforeClick[0],
        center.lat - centerBeforeClick[1],
      );
    })
    .toBeGreaterThan(0.01);
  await page.evaluate(() => window._map?.jumpTo({ zoom: 10 }));
  await expect
    .poll(async () => Number(await minimap.getAttribute("data-viewport-width")))
    .toBeGreaterThan(closeViewportWidth);

  await chooseFilterOption(page, "landmark:trail-east");
  await expect(minimap).toHaveAttribute("data-activity-count", "1");
  await page.locator('[data-filter-token-id="landmark:trail-east"]').click();
  await page
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  await expect(minimap).toHaveAttribute("data-activity-count", "3");
  await page.evaluate(() => window._map?.remove()).catch(() => {});
});

test("the minimap reuses its static raster during movement and rebuilds it for filters", async ({
  page,
}) => {
  await page.goto(
    "/?performanceDiagnostics=1&performanceVariant=full#17/1.2858/103.8579/0/60",
  );
  const minimap = page.locator("#event-density-minimap");
  await expect(minimap).toBeVisible();
  await expect
    .poll(async () =>
      Number(await minimap.getAttribute("data-static-render-count")),
    )
    .toBeGreaterThan(0);
  const beforeMove = {
    renders: Number(await minimap.getAttribute("data-render-count")),
    staticRenders: Number(
      await minimap.getAttribute("data-static-render-count"),
    ),
  };

  await page.evaluate(() => window._map.fire("move"));
  await expect
    .poll(async () => Number(await minimap.getAttribute("data-render-count")))
    .toBeGreaterThan(beforeMove.renders);
  await expect
    .poll(async () =>
      Number(await minimap.getAttribute("data-static-render-count")),
    )
    .toBe(beforeMove.staticRenders);

  await chooseFilterOption(page, "landmark:trail-east");
  await expect(minimap).toHaveAttribute("data-activity-count", "1");
  await expect
    .poll(async () =>
      Number(await minimap.getAttribute("data-static-render-count")),
    )
    .toBe(beforeMove.staticRenders + 1);
  await page.evaluate(() => window._map.remove());
});

test("cached and legacy minimap rendering remain visually equivalent", async ({
  page,
}) => {
  const imageFor = async (variant) => {
    await page.goto(
      `/?performanceDiagnostics=1&performanceVariant=${variant}#17/1.2858/103.8579/0/60`,
    );
    await expect(page.locator("#event-density-minimap")).toBeVisible();
    await page.evaluate(async () => {
      window._map.jumpTo({
        center: [103.8579, 1.2858],
        zoom: 17,
        bearing: 0,
        pitch: 60,
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    return page
      .locator("#event-density-minimap canvas")
      .evaluate((canvas) =>
        Array.from(
          canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      );
  };
  const cached = await imageFor("full");
  const legacy = await imageFor("legacy-minimap-render");
  const differentPixels = Array.from(
    { length: cached.length / 4 },
    (_, pixel) =>
      cached
        .slice(pixel * 4, pixel * 4 + 4)
        .some((value, channel) => value !== legacy[pixel * 4 + channel]),
  ).filter(Boolean).length;
  const maximumChannelDifference = Math.max(
    ...cached.map((value, index) => Math.abs(value - legacy[index])),
  );
  const meanAbsoluteDifference =
    cached.reduce(
      (total, value, index) => total + Math.abs(value - legacy[index]),
      0,
    ) / cached.length;
  expect(differentPixels / (cached.length / 4)).toBeLessThanOrEqual(0.02);
  expect(meanAbsoluteDifference).toBeLessThanOrEqual(1);
  expect(maximumChannelDifference).toBeLessThanOrEqual(128);
  await page.evaluate(() => window._map.remove());
});

test("anonymous startup renders one compact full-title pill and tracks its map anchor", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const pill = page.locator("#fixture-hall-event-pill");
  await expect(pill).toHaveCount(1);
  await expect(pill.locator(".landmark-event-pill__title")).toHaveText(
    "A Complete Event Title That Must Never Be Truncated",
  );
  const before = await page
    .locator("body")
    .getAttribute("data-landmark-event-pill-position-pass-count");
  await page.evaluate(() => window._map.fire("move"));
  await expect
    .poll(async () =>
      Number(
        await page
          .locator("body")
          .getAttribute("data-landmark-event-pill-position-pass-count"),
      ),
    )
    .toBeGreaterThan(Number(before));
  await expect(page.locator("#landmark-event-panel")).toBeHidden();
  await page.evaluate(() => window._map?.remove()).catch(() => {});
});

test("zoomed-out discovery counts lead toward event pills", async ({
  page,
}) => {
  await page.goto("/#10/1.3521/103.8198/0/45");
  const counts = page.locator(".landmark-event-cluster__count");
  await expect.poll(() => counts.count()).toBeGreaterThan(0);
  await expect(
    page.locator(".landmark-event-pill:not(.is-hidden)"),
  ).toHaveCount(0);

  const beforeZoom = await page.evaluate(() => window._map.getZoom());
  await counts.first().click();
  await expect
    .poll(() => page.evaluate(() => window._map.getZoom()))
    .toBeGreaterThan(beforeZoom);

  await page.evaluate(() =>
    window._map.jumpTo({
      center: [103.8579, 1.2858],
      zoom: 17,
    }),
  );
  await expect(counts).toHaveCount(0);
  await expect(page.locator("#fixture-hall-event-pill")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await page.evaluate(() => window._map?.remove()).catch(() => {});
});

test("a multi-location activity is labelled at each mapped venue", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  await expect(
    page.locator("#trail-east-event-pill .landmark-event-pill__location"),
  ).toHaveText("Multiple locations");
  await expect(
    page.locator("#trail-west-event-pill .landmark-event-pill__location"),
  ).toHaveText("Multiple locations");
  await page.evaluate(() => window._map.remove());
});

test("multiple events share one landmark pill and one singleton detail panel", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  await page
    .locator("#fixture-hall-event-pill .landmark-event-pill__card")
    .click();
  const panel = page.locator("#landmark-event-panel");
  await expect(panel).toBeVisible();
  await expect(
    panel.locator(".landmark-event-panel__event-position"),
  ).toContainText("of 2");
  await expect(page.locator("#landmark-event-panel")).toHaveCount(1);
  await page.evaluate(() => window._map.remove());
});

test("empty snapshots keep the mobile toolbar compact and hide laptop-only map controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?emptyApprovedSnapshot#17/1.2858/103.8579/0/60");
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-search")).toBeVisible();
  await expect(
    page.locator(".landmark-event-search__actions > button"),
  ).toHaveCount(2);
  await expect(page.locator("#map-guidance")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show feature tour" }),
  ).toBeVisible();
  for (const name of ["Zoom in", "Zoom out", "Rotate map"])
    await expect(page.getByRole("button", { name })).toBeHidden();
  const mobileToolbar = await page.evaluate(() => {
    const toolbar = document
      .getElementById("landmark-event-search")
      .getBoundingClientRect();
    const buttons = [
      ...document.querySelectorAll(".landmark-event-search__actions > button"),
    ].map((button) => button.getBoundingClientRect());
    const builder = document
      .querySelector(".landmark-event-search__builder")
      .getBoundingClientRect();
    return {
      bottom: toolbar.bottom,
      builderHeight: builder.height,
      builderTop: builder.top,
      height: toolbar.height,
      iconTop: Math.min(...buttons.map(({ top }) => top)),
      left: toolbar.left,
      right: toolbar.right,
      rowSpread:
        Math.max(...buttons.map(({ top }) => top)) -
        Math.min(...buttons.map(({ top }) => top)),
    };
  });
  expect(mobileToolbar.left).toBeGreaterThanOrEqual(8);
  expect(mobileToolbar.right).toBeLessThanOrEqual(382);
  expect(mobileToolbar.height).toBeLessThanOrEqual(160);
  expect(mobileToolbar.bottom).toBeLessThanOrEqual(172);
  expect(mobileToolbar.rowSpread).toBeLessThanOrEqual(1);
  expect(mobileToolbar.builderHeight).toBeGreaterThanOrEqual(44);
  expect(mobileToolbar.builderTop).toBeLessThan(mobileToolbar.iconTop);

  const expandedHeight = mobileToolbar.height;
  const transitionDurations = await page.evaluate(() => ({
    controls: getComputedStyle(
      document.querySelector(".landmark-event-search__controls"),
    ).transitionDuration,
    toolbar: getComputedStyle(document.getElementById("landmark-event-search"))
      .transitionDuration,
  }));
  expect(transitionDurations.controls).not.toBe("0s");
  expect(transitionDurations.toolbar).not.toBe("0s");
  await expect(
    page.getByRole("button", {
      name: /Collapse search controls|Expand search controls/,
    }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("whats-here:overlay-open", {
        detail: { id: "restaurants" },
      }),
    ),
  );
  await expect(page.locator("#landmark-event-search")).toHaveClass(
    /is-collapsed/,
  );
  await expect(page.locator(".landmark-event-search__controls")).toBeHidden();
  await expect(
    page.locator(".landmark-event-search__collapsed-indicator"),
  ).toBeVisible();
  const collapsedHeight = await page
    .locator("#landmark-event-search")
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(collapsedHeight).toBeLessThan(expandedHeight);

  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("whats-here:overlay-close", {
        detail: { id: "restaurants" },
      }),
    ),
  );
  await expect(page.locator("#landmark-event-search")).not.toHaveClass(
    /is-collapsed/,
  );
  await expect(page.locator(".landmark-event-search__controls")).toBeVisible();
  await page.evaluate(() => window._map.remove());
});

test("only the secret-location filter remains and location types move into activity details", async ({
  page,
}) => {
  await page.goto("/#17/1.2858/103.8579/0/60");
  const search = page.locator("#landmark-event-search-input");
  await search.focus();
  await page.locator('[data-filter-dimension="where"]').click();
  await expect(
    page.getByRole("option", { name: "Mystery Location", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mapped", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Multiple locations" }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: "Mystery Location", exact: true })
    .click();
  const secret = page.getByRole("option", { name: /Secret Supper/ });
  await expect(secret).toContainText("Anytime");
  const centerBefore = await page.evaluate(() =>
    window._map.getCenter().toArray(),
  );
  await secret.click();
  await expect(page.locator("#landmark-event-panel")).toBeVisible();
  await expect(
    page.locator(".landmark-event-panel__field--locationType"),
  ).toContainText("Mystery Location");
  expect(await page.evaluate(() => window._map.getCenter().toArray())).toEqual(
    centerBefore,
  );
  await page.getByRole("button", { name: "Back to events" }).click();
  await expect(page.locator("#landmark-event-panel")).toBeHidden();

  await search.focus();
  await page.locator('[data-filter-token-id="where:mystery-location"]').click();
  await page
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  const multiple = page.getByRole("option", { name: /Studio Trail/ });
  await expect(multiple).toContainText("May be outdated");
  await expect(multiple).toContainText("Multiple locations");

  await multiple.click();
  await expect(
    page.locator(".landmark-event-panel__field--locationType"),
  ).toContainText("Multiple locations");
  await page.evaluate(() => window._map.remove());
});
