import { expect, test } from "playwright/test";

const restaurants = [
  {
    id: "osm-node-42",
    osm: { type: "node", id: "42", url: "https://www.openstreetmap.org/node/42" },
    name: "Example Kitchen",
    category: "restaurant",
    cuisine: "singaporean;asian",
    address: "3 Example Road, Singapore 018900",
    latitude: 1.285,
    longitude: 103.858,
    openingHours: "Mo-Su 11:00-22:00",
    phone: "+65 6000 0000",
    website: "https://example.com/",
    dietary: ["vegetarian"],
    takeaway: "yes",
    delivery: "no",
  },
  {
    id: "osm-node-43",
    osm: { type: "node", id: "43", url: "https://www.openstreetmap.org/node/43" },
    name: "Fish & Chips <script>alert(1)</script>",
    category: "cafe",
    cuisine: "british",
    address: "4 Example Road",
    latitude: 1.286,
    longitude: 103.859,
    dietary: [],
  },
];

async function mockRestaurantApi(page, { restaurantGate = null, restaurantPayload = null, dealPayload = null } = {}) {
  const requests = { bbox: null, batchIds: [], dealStatusIds: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/restaurants") {
      if (restaurantGate) await restaurantGate;
      requests.bbox = url.searchParams.get("bbox");
      return route.fulfill({ json: restaurantPayload || { source: "OpenStreetMap / Overpass", fetchedAt: new Date().toISOString(), restaurants } });
    }
    if (url.pathname === "/api/restaurant-deals/batch") {
      requests.batchIds = (await request.postDataJSON()).restaurantIds;
      return route.fulfill({ status: 202, json: { jobs: requests.batchIds.map((id) => ({ restaurantId: id, status: "queued" })) } });
    }
    if (url.pathname === "/api/restaurant-deals") {
      requests.dealStatusIds.push(url.searchParams.get("id"));
      const selectedDealPayload = typeof dealPayload === "function" ? dealPayload(requests.dealStatusIds.length) : dealPayload;
      return route.fulfill({ json: selectedDealPayload || {
        restaurantId: url.searchParams.get("id"),
        status: "complete",
        result: {
          status: "success",
          pagesInspected: [{ url: "https://example.com/promotions", status: "success" }],
          deals: [{
            id: "deal-1",
            title: "Weekday dinner promotion",
            evidence: "Enjoy 20% off dinner from Monday to Thursday.",
            sourceUrl: "https://example.com/promotions",
            sourceType: "official_website",
          }],
        },
      } });
    }
    return route.abort();
  });
  return requests;
}

test("button searches the visible map area, clusters locations, lists restaurants, and opens deal details", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  let releaseRestaurantSearch;
  const restaurantGate = new Promise((resolve) => { releaseRestaurantSearch = resolve; });
  const requests = await mockRestaurantApi(page, {
    restaurantGate,
    dealPayload: (requestCount) => requestCount <= 3 ? {
      restaurantId: "osm-node-42",
      status: "pending",
      progress: { stage: "searching_website", label: "Searching for the official website…" },
    } : null,
  });
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await expect.poll(() => page.locator("body").getAttribute("data-restaurant-explorer")).toBe("mounted");
  const mapStateBeforeSearch = await page.evaluate(() => {
    const bounds = window._map.getBounds();
    return {
      center: window._map.getCenter().toArray(),
      bounds: [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()],
    };
  });
  await page.locator("#restaurant-search-button").click();

  await expect(page.locator("#restaurant-search-button")).toHaveClass(/is-loading/);
  await expect(page.locator("#restaurant-search-button")).toHaveAttribute("aria-label", "Searching for restaurants in this area");
  await expect(page.locator("#restaurant-search-button > i")).toBeHidden();
  await expect(page.locator("#restaurant-results")).toBeHidden();
  await expect(page.locator(".restaurant-results__status")).not.toContainText("Searching OpenStreetMap");
  releaseRestaurantSearch();

  await expect(page.locator(".restaurant-results__pill")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator("#restaurant-results")).toBeVisible();
  await expect(page.locator("#restaurant-search-button")).not.toHaveClass(/is-loading/);
  await expect(page.locator(".restaurant-results__count")).toHaveCount(0);
  await expect(page.locator(".restaurant-results__close")).toHaveAttribute("aria-label", "Close restaurant results");
  await expect(page.locator(".restaurant-results__close .ph-x")).toHaveCount(1);
  await expect(page.locator(".restaurant-results__search-input")).toBeVisible();
  const categoryFilter = page.locator("#restaurant-category-filter");
  const cuisineFilter = page.locator("#restaurant-cuisine-filter");
  await expect(categoryFilter).toHaveValue("all");
  await expect(categoryFilter.locator("option")).toHaveCount(3);
  await expect(cuisineFilter).toHaveValue("all");
  await categoryFilter.selectOption("cafe");
  await expect(page.locator(".restaurant-results__pill")).toHaveCount(1);
  await expect(page.locator(".restaurant-results__breadcrumbs")).toContainText("Cafe");
  await expect(cuisineFilter.locator('option[value="british"]')).toHaveText("British · 1");
  await cuisineFilter.selectOption("british");
  await expect(page.locator(".restaurant-results__breadcrumbs")).toContainText("British");
  await categoryFilter.selectOption("restaurant");
  await expect(cuisineFilter).toHaveValue("all");
  await expect(cuisineFilter.locator('option[value="british"]')).toHaveCount(0);
  expect(await page.evaluate(() => window._map.getSource("viewport-restaurants")._data.features.length)).toBe(1);
  await page.getByRole("button", { name: "All restaurants" }).click();
  await page.locator(".restaurant-results__search-input").fill("Kitchen");
  await expect(page.locator(".restaurant-results__pill")).toHaveCount(1);
  await expect(page.locator(".restaurant-results__breadcrumbs")).toContainText("Search: Kitchen");
  await page.locator(".restaurant-results__search-input").fill("");
  await expect(page.locator(".restaurant-results__pill")).toHaveCount(2);
  const [south, west, north, east] = requests.bbox.split(",").map(Number);
  expect((south + north) / 2).toBeCloseTo(mapStateBeforeSearch.center[1], 5);
  expect((west + east) / 2).toBeCloseTo(mapStateBeforeSearch.center[0], 5);
  expect(north - mapStateBeforeSearch.center[1]).toBeCloseTo(mapStateBeforeSearch.center[1] - south, 5);
  expect(east - mapStateBeforeSearch.center[0]).toBeCloseTo(mapStateBeforeSearch.center[0] - west, 5);
  expect(north).toBeLessThan(mapStateBeforeSearch.bounds[2]);
  expect(requests.batchIds).toEqual([]);
  expect(requests.dealStatusIds).toEqual([]);

  const mapState = await page.evaluate(() => ({
    hasSource: Boolean(window._map.getSource("viewport-restaurants")),
    hasClusters: Boolean(window._map.getLayer("viewport-restaurant-clusters")),
    hasClusterCounts: Boolean(window._map.getLayer("viewport-restaurant-cluster-count")),
    hasPoints: Boolean(window._map.getLayer("viewport-restaurant-points")),
    clusterColor: window._map.getPaintProperty("viewport-restaurant-clusters", "circle-color"),
    clusterRadius: window._map.getPaintProperty("viewport-restaurant-clusters", "circle-radius"),
    pointColor: window._map.getPaintProperty("viewport-restaurant-points", "circle-color"),
    pointRadius: window._map.getPaintProperty("viewport-restaurant-points", "circle-radius"),
  }));
  expect(mapState).toEqual({
    hasSource: true,
    hasClusters: true,
    hasClusterCounts: true,
    hasPoints: true,
    clusterColor: "#172033",
    clusterRadius: ["step", ["get", "point_count"], 14, 10, 18, 50, 22],
    pointColor: "#172033",
    pointRadius: 6,
  });

  await page.locator('[data-restaurant-id="osm-node-42"]').click();
  await expect.poll(() => requests.dealStatusIds).toContain("osm-node-42");
  await expect(page.locator("#restaurant-detail")).toBeVisible();
  await expect(page.locator(".restaurant-detail__deal-status--loading")).toHaveText("Searching for the official website…");
  await expect(page.locator(".restaurant-detail__deal-status--loading")).toHaveCSS("display", "flex");
  await expect.poll(() => page.evaluate(() => window._map.getZoom())).toBeGreaterThanOrEqual(16.9);
  await expect(page.locator("#restaurant-detail-title")).toHaveText("Example Kitchen");
  await expect(page.locator(".restaurant-detail__kicker")).toHaveCount(0);
  await expect(page.locator(".restaurant-detail__actions .restaurant-detail__plan")).toHaveAttribute("aria-label", "Add restaurant to plan");
  await expect(page.locator(".restaurant-detail__header-link")).toHaveAttribute("href", "https://example.com/");
  await expect(page.locator(".restaurant-detail__directions")).toHaveAttribute("aria-label", "Get directions to restaurant");
  await expect(page.locator(".restaurant-detail__directions")).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=1.285%2C103.858");
  await expect(page.locator(".restaurant-detail__label", { hasText: /^(Website|Map data)$/ })).toHaveCount(0);
  await expect(page.locator(".restaurant-detail__field--reference .restaurant-detail__label")).toHaveText("Reference");
  await expect(page.locator(".restaurant-detail__field--reference .restaurant-detail__link")).toHaveText("OpenStreetMap");
  await expect(page.locator(".restaurant-detail__field--reference .restaurant-detail__link")).toHaveAttribute("href", "https://www.openstreetmap.org/node/42");
  const actionBoxes = await page.locator(".restaurant-detail__actions .restaurant-detail__action").evaluateAll((actions) => actions.map((action) => {
    const box = action.getBoundingClientRect();
    return { top: box.top, width: box.width, height: box.height };
  }));
  expect(new Set(actionBoxes.map(({ top }) => top)).size).toBe(1);
  expect(actionBoxes.every(({ width, height }) => width === 42 && height === 42)).toBe(true);
  const headerLayout = await page.locator(".restaurant-detail__header").evaluate((header) => {
    const controlsBottom = Math.max(
      header.querySelector(".restaurant-detail__back").getBoundingClientRect().bottom,
      header.querySelector(".restaurant-detail__actions").getBoundingClientRect().bottom,
    );
    return { controlsBottom, titleTop: header.querySelector(".restaurant-detail__title").getBoundingClientRect().top };
  });
  expect(headerLayout.titleTop).toBeGreaterThan(headerLayout.controlsBottom);
  const detailValues = page.locator(".restaurant-detail__value");
  await expect(detailValues.nth(0)).toHaveText("OpenStreetMap");
  await expect(detailValues.nth(1)).toHaveText("restaurant");
  await expect(detailValues.nth(2)).toHaveText("singaporean, asian");
  await expect(detailValues.nth(3)).toHaveText("3 Example Road, Singapore 018900");
  await expect(page.locator(".restaurant-detail__hours-days")).toHaveText("Monday-Sunday");
  await expect(page.locator(".restaurant-detail__hours-time")).toHaveText("11:00-22:00");
  await expect(page.locator(".restaurant-detail__deal-evidence")).toHaveText("Enjoy 20% off dinner from Monday to Thursday.");
  await expect(page.locator(".restaurant-detail__deal-source")).toHaveAttribute("href", "https://example.com/promotions");
  await page.locator(".restaurant-detail__plan").click();
  await expect(page.locator("#plan-builder-button")).toHaveAttribute("aria-label", "Plan, 1 stop");
  await expect(page.locator(".plan-builder__stop:not(.plan-builder__stop--origin) .plan-builder__stop-title")).toHaveText("Example Kitchen");
  await expect(page.locator("#plan-builder")).toBeVisible();
  await expect(page.locator("#restaurant-detail")).toBeHidden();
  await expect(page.locator("#restaurant-results")).toBeHidden();
  await page.locator(".plan-builder__close").click();
  await expect(page.locator("#restaurant-search-button")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("body")).toHaveAttribute("data-restaurant-count", "0");
  expect(consoleErrors.filter((message) => /viewport-restaurant-cluster-count|text-field.*glyphs/i.test(message))).toEqual([]);
});

test("stale restaurant and deal envelopes are labelled and expired deals stay hidden", async ({ page }) => {
  const fetchedAt = "2026-07-13T00:00:00.000Z";
  await mockRestaurantApi(page, {
    restaurantPayload: {
      schemaVersion: "1.0", status: "success", data: { restaurants }, fetchedAt, stale: true,
      warning: "live source unavailable", source: { id: "openstreetmap-overpass", costClass: "open" },
    },
    dealPayload: {
      schemaVersion: "1.0", restaurantId: "osm-node-42", status: "success", stale: true, fetchedAt,
      source: { id: "official-website-direct", costClass: "free" },
      data: { status: "success", fetchedAt, pagesInspected: [], deals: [{
        id: "expired", title: "Old deal", evidence: "20% off", sourceUrl: "https://example.com/old", validUntil: "2026-01-01T23:59:59.999Z",
      }] },
    },
  });
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await page.locator("#restaurant-search-button").click();
  await expect(page.locator(".restaurant-results__freshness")).toBeHidden();
  await page.locator('[data-restaurant-id="osm-node-42"]').click();
  await expect(page.locator(".restaurant-detail__stale")).toHaveText("Potentially outdated");
  await expect(page.locator(".restaurant-detail__deal", { hasText: "Old deal" })).toHaveCount(0);
  await expect(page.locator(".restaurant-detail__deal-status")).toContainText("No current deals");
});

test("restaurant names are rendered as text and the list remains usable on a narrow viewport", async ({ page }) => {
  await mockRestaurantApi(page);
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await page.setViewportSize({ width: 390, height: 760 });
  await expect.poll(() => page.locator("body").getAttribute("data-restaurant-explorer")).toBe("mounted");
  await page.locator("#restaurant-search-button").click();
  const unsafe = page.locator('[data-restaurant-id="osm-node-43"] .restaurant-results__name');
  await expect(unsafe).toHaveText("Fish & Chips <script>alert(1)</script>");
  await expect(page.locator(".restaurant-results script")).toHaveCount(0);
  const box = await page.locator("#restaurant-results").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.locator('[data-restaurant-id="osm-node-43"]').click();
  await expect(page.locator("#restaurant-detail")).toBeVisible();
  const detailBox = await page.locator("#restaurant-detail").boundingBox();
  expect(detailBox).toEqual(box);
  const backButton = page.getByRole("button", { name: "Back to restaurant results" });
  await expect(backButton).toBeVisible();
  await backButton.click();
  await expect(page.locator("#restaurant-detail")).toBeHidden();
  await expect(page.locator("#restaurant-results")).toBeVisible();
  await expect(page.locator('[data-restaurant-id="osm-node-43"]')).toBeFocused();
});

test("restaurant detail gives the name its own row and validates the directions link", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createRestaurantDetail } = await import("/activity-scenes/restaurants/restaurant-detail.js");
    const detail = createRestaurantDetail();
    detail.open({ name: "Example Kitchen", latitude: 1.285, longitude: 103.858 }, document.getElementById("map-focus"));
    const header = document.querySelector(".restaurant-detail__header");
    const controlsBottom = Math.max(
      header.querySelector(".restaurant-detail__back").getBoundingClientRect().bottom,
      header.querySelector(".restaurant-detail__actions").getBoundingClientRect().bottom,
    );
    const result = {
      directions: header.querySelector(".restaurant-detail__directions").href,
      hasKicker: Boolean(header.querySelector(".restaurant-detail__kicker")),
      name: header.querySelector(".restaurant-detail__title").textContent,
      nameHasOwnRow: header.querySelector(".restaurant-detail__title").getBoundingClientRect().top > controlsBottom,
    };
    detail.open({ name: "Missing location" }, document.getElementById("map-focus"));
    result.directionsHiddenWithoutCoordinates = header.querySelector(".restaurant-detail__directions").hidden;
    detail.destroy();
    return result;
  });
  expect(state).toEqual({
    directions: "https://www.google.com/maps/dir/?api=1&destination=1.285%2C103.858",
    directionsHiddenWithoutCoordinates: true,
    hasKicker: false,
    name: "Example Kitchen",
    nameHasOwnRow: true,
  });
});
