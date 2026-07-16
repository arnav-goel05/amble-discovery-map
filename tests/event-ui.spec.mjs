import { expect, test } from "playwright/test";

test("empty approved snapshot renders no highlights, pills, or panels", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?autoStart&emptyApprovedSnapshot&rawTiles#8/1.285844/103.857897/-30/60");
  await expect(page.locator("#warning")).toHaveCount(0);
  await expect.poll(() => page.locator("body").getAttribute("data-poi-highlight-manager")).toBe("combined");
  await expect(page.locator('[id^="poi-"][id$="-3d"]')).toHaveCount(0);
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-panel")).toHaveCount(1);
  await expect(page.locator("#landmark-event-panel")).toBeHidden();
  await expect(page.locator(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .maplibregl-ctrl-compass")).toHaveCount(0);
  await expect(page.locator("#map-guidance")).toBeVisible();
  await expect(page.locator(".app-brand")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-tile-error-count", /[1-9]/);
  await expect(page.locator("body")).not.toHaveAttribute("data-poi-tile-error-count", /[1-9]/);
  await expect(page.locator("body")).toHaveAttribute("data-poi-preload", "disabled");
  await expect(page.locator("body")).toHaveAttribute("data-poi-preload-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-poi-active-layer-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-poi-configured-layer-count", "0");
  await expect(page.locator("body")).toHaveAttribute("data-background-maximum-screen-space-error", "4");
  await expect(page.locator("body")).toHaveAttribute("data-poi-default-maximum-screen-space-error", "4");
  await expect(page.locator("body")).toHaveAttribute("data-background-tileset-url", "optimized-tiles/tileset.json?assetMount=site-root-v1");
  expect(errors).toEqual([]);

  await page.evaluate(() => window._map.remove());
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-panel")).toHaveCount(0);
});

test("clicking the map dismisses whichever side panel is open", async ({ page }) => {
  await page.goto("/?autoStart&emptyApprovedSnapshot#17/1.285844/103.857897/-30/60");
  await expect.poll(() => page.locator("body").getAttribute("data-plan-builder")).toBe("mounted");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:add-to-plan", { detail: {
    id: "map-dismiss-stop",
    type: "event",
    title: "Map dismiss test",
    place: "Esplanade",
    latitude: 1.2897,
    longitude: 103.8559,
  } })));
  await expect(page.locator("#plan-builder")).toBeVisible();
  await page.locator(".maplibregl-canvas").dispatchEvent("click", { button: 0 });
  await expect(page.locator("#plan-builder")).toBeHidden();
});

test("legacy demo landmarks are not mounted", async ({ page }) => {
  await page.goto("/?autoStart&demoLandmarks#17/1.285844/103.857897/-30/60");
  await expect(page.getByRole("button", { name: /Lau Pa Sat|Fullerton Hotel|National Gallery/i })).toHaveCount(0);
  await expect(page.locator('[id^="demo:"]')).toHaveCount(0);
});

test("location focus zooms in from a wide view without zooming out a close view", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { focusMapLocation, zoomMapToMinimum } = await import("/activity-scenes/map-location-focus.js");
    const recorded = [];
    const map = { getZoom: () => 12, easeTo: (options) => recorded.push(options) };
    const zoomedToPills = zoomMapToMinimum(map);
    focusMapLocation(map, { lat: 1.29, lng: 103.85 });
    map.getZoom = () => 18;
    const preservedCloseZoom = zoomMapToMinimum(map);
    focusMapLocation(map, { latitude: 1.3, longitude: 103.86 }, { duration: 500 });
    return { preservedCloseZoom, recorded, zoomedToPills };
  });
  expect(state).toEqual({
    preservedCloseZoom: false,
    recorded: [
      { zoom: 16.65, duration: 700 },
      { center: [103.85, 1.29], zoom: 17, duration: 700 },
      { center: [103.86, 1.3], zoom: 18, duration: 500 },
    ],
    zoomedToPills: true,
  });
});

test("bottom-left map guidance exposes working zoom and rotation controls", async ({ page }) => {
  await page.goto("/test-harness.html");
  const actions = await page.evaluate(async () => {
    const { addMapGuidanceControls } = await import("/activity-scenes/map-guidance-controls.js");
    const calls = [];
    const controls = addMapGuidanceControls({
      easeTo: (options) => calls.push(["rotate", options]),
      getBearing: () => 15,
      zoomIn: (options) => calls.push(["in", options]),
      zoomOut: (options) => calls.push(["out", options]),
    });
    document.querySelector('[aria-label="Zoom in"]').click();
    document.querySelector('[aria-label="Zoom out"]').click();
    document.querySelector('[aria-label="Rotate map"]').click();
    const icons = [...document.querySelectorAll(".map-guidance i")].map((icon) => icon.className);
    controls.finalize();
    return { calls, icons };
  });
  expect(actions).toEqual({
    calls: [["in", { duration: 300 }], ["out", { duration: 300 }], ["rotate", { bearing: 60, duration: 450 }]],
    icons: ["ph-bold ph-plus", "ph-bold ph-minus", "ph-bold ph-arrow-clockwise", "ph-bold ph-question"],
  });
});

test("search selection centers the event pill without a redundant direction pointer", async ({ page }) => {
  await page.goto("/?autoStart#12/1.34/103.70/0/0");
  await expect.poll(() => page.locator("body").getAttribute("data-landmark-event-pills")).toBe("mounted");
  await page.locator("#landmark-event-search-input").fill("Sampan Rides");
  await page.locator(".landmark-event-search__result", { hasText: "Sampan Rides" }).click();
  await expect(page.locator("#landmark-event-search-results")).toBeHidden();
  const selectedLandmarkId = await page.locator("body").getAttribute("data-poi-selected-layer-id");
  expect(selectedLandmarkId).toBeTruthy();
  await expect(page.locator("body")).toHaveAttribute("data-poi-selected-maximum-screen-space-error", "4");
  expect(await page.evaluate(() => Boolean(window._map.getLayer("event-venues-3d")))).toBe(true);
  expect(await page.evaluate(() => Object.keys(window._map.style?._layers || {}).filter((id) => /^poi-.+-3d$/.test(id)).length)).toBe(0);
  await expect.poll(() => page.evaluate(() => window._map.getZoom())).toBeGreaterThanOrEqual(16.9);
  await expect.poll(
    () => page.locator("body").getAttribute("data-tile-refinement-state"),
    { timeout: 20_000 },
  ).toBe("full-detail");
  await expect(page.locator("body")).toHaveAttribute("data-background-current-maximum-screen-space-error", "4");
  await expect(page.locator(".landmark-direction-indicator")).toHaveCount(0);
  await expect(page.locator(".landmark-event-pill.is-navigation-target .landmark-event-pill__card")).toBeVisible();
  await expect(page.locator("#landmark-event-search-results")).toBeHidden();
  await expect.poll(async () => (
    await page.locator("body").getAttribute("data-poi-active-layer-screen-space-errors") || ""
  )).toContain("event-venues-3d:4");
  await expect(page.locator("body")).toHaveAttribute("data-poi-combined-tileset-loaded", "true");
  await expect(page.locator("body")).not.toHaveAttribute("data-poi-tile-error-count", /[1-9]/);
  const center = await page.evaluate(() => window._map.getCenter().toArray());
  expect(center[0]).toBeCloseTo(103.8589, 2);
  expect(center[1]).toBeCloseTo(1.2841, 2);
});

test("event search matches titles, venues, and dates and reports empty results", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: { id: "library", label: "National Library", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "journey", title: "Journey to the West", venue: "Drama Centre", dateText: "14 Jul 2026" }],
    });
    const search = createLandmarkEventSearch({ onSearch: (query) => layer.setSearchQuery(query) });
    const input = search.input;
    const searchFor = (query) => {
      input.value = query;
      input.dispatchEvent(new Event("input"));
      return {
        hidden: document.querySelector(".landmark-event-pill").getAttribute("aria-hidden"),
        status: document.querySelector(".landmark-event-search__status").textContent,
      };
    };
    const state = { title: searchFor("journey"), venue: searchFor("drama"), date: searchFor("14 jul"), none: searchFor("opera") };
    search.destroy();
    layer.destroy();
    return state;
  });
  expect(result).toEqual({
    title: { hidden: "false", status: "" },
    venue: { hidden: "false", status: "" },
    date: { hidden: "false", status: "" },
    none: { hidden: "true", status: "No matching events" },
  });
});

test("event search shows selectable results and category filters", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    let selection = null;
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel", onSelect: (value) => { selection = value; } });
    layer.add({
      landmark: { id: "arts-centre", label: "Arts Centre", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "concert", title: "Evening Jazz Concert", venue: "Concert Hall", dateText: "14 Jul 2026" },
        { id: "talk", title: "Architecture Talk", venue: "Studio", dateText: "15 Jul 2026" },
      ],
    });
    const search = createLandmarkEventSearch({
      categories: layer.categories(),
      onFilter: (filters) => layer.setFilters(filters),
      onResultSelect: (item) => layer.selectResult(item),
    });
    search.input.value = "concert";
    search.input.dispatchEvent(new Event("input"));
    const resultTitle = document.querySelector(".landmark-event-search__result strong")?.textContent;
    document.querySelector(".landmark-event-search__result")?.click();
    const categoryButtons = [...document.querySelectorAll(".landmark-event-search__category")];
    categoryButtons[0]?.click();
    categoryButtons[1]?.click();
    const output = {
      categories: [...document.querySelectorAll(".landmark-event-search__category")].map((node) => node.getAttribute("aria-label")),
      icons: [...document.querySelectorAll(".landmark-event-search__category i")].map((node) => node.className),
      pressed: categoryButtons.map((node) => node.getAttribute("aria-pressed")),
      resultTitle,
      selected: selection?.sourceEvents[selection.selectedEventIndex]?.id,
    };
    search.destroy();
    layer.destroy();
    return output;
  });
  expect(result).toEqual({
    categories: ["Performances", "Workshops & Classes"],
    icons: ["ph-bold ph-microphone-stage", "ph-bold ph-paint-brush"],
    pressed: ["false", "true"],
    resultTitle: "Evening Jazz Concert",
    selected: "concert",
  });
});

test("event search exposes a working date filter without a price filter", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    let filters = null;
    const search = createLandmarkEventSearch({
      onFilter: (nextFilters) => {
        filters = nextFilters;
        return { matchedEvents: 0, query: nextFilters.query, results: [] };
      },
    });
    const endBlankByDefault = search.filters.dateEnd.value;
    search.filters.dateEnd.value = "2026-07-14";
    search.filters.dateButton.click();
    const endBlankWhenAnyDateOpens = search.filters.dateEnd.value;
    search.filters.dateStart.value = "2026-07-14";
    search.filters.dateStart.dispatchEvent(new Event("input"));
    const startOnlyLabel = search.filters.dateButton.textContent;
    search.filters.dateEnd.value = "2026-07-14";
    search.filters.dateEnd.dispatchEvent(new Event("input"));
    const sameDayLabel = search.filters.dateButton.textContent;
    search.filters.dateEnd.value = "2026-07-21";
    search.filters.dateEnd.dispatchEvent(new Event("input"));
    const dateLabelBeforeApply = search.filters.dateButton.textContent;
    search.filters.dateApply.click();
    const output = {
      dateLabel: search.filters.dateButton.textContent,
      dateLabelBeforeApply,
      endBlankByDefault,
      endBlankWhenAnyDateOpens,
      hasPriceFilter: Boolean(document.querySelector('[name="priceRange"]')),
      sameDayLabel,
      startOnlyLabel,
      filters,
    };
    search.destroy();
    return output;
  });
  expect(result).toEqual({
    dateLabel: "14 Jul - 21 Jul",
    dateLabelBeforeApply: "14 Jul - 21 Jul",
    endBlankByDefault: "",
    endBlankWhenAnyDateOpens: "",
    hasPriceFilter: false,
    sameDayLabel: "14 Jul",
    startOnlyLabel: "From 14 Jul",
    filters: {
      categories: [], query: "", dateRange: "custom", dateStart: "2026-07-14", dateEnd: "2026-07-21",
    },
  });
});

test("search navigation can select an event without opening its detail callback", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    let openedDetails = false;
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel", onSelect: () => { openedDetails = true; } });
    layer.add({
      landmark: { id: "arts-centre", label: "Arts Centre", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "concert", title: "Evening Jazz Concert", dateText: "14 Jul 2026" },
        { id: "talk", title: "Architecture Talk", dateText: "15 Jul 2026" },
      ],
    });
    const selected = layer.selectResult({ landmarkId: "arts-centre", eventIndex: 1 }, { notify: false });
    const highlighted = layer.setNavigationTarget("arts-centre");
    const pill = document.querySelector(".landmark-event-pill");
    const pillTitle = document.querySelector(".landmark-event-pill__title").textContent;
    const navigationState = {
      current: pill.querySelector(".landmark-event-pill__card").getAttribute("aria-current"),
      highlighted: pill.classList.contains("is-navigation-target"),
    };
    layer.destroy();
    return { highlighted, navigationState, openedDetails, pillTitle, selected };
  });
  expect(result).toEqual({
    highlighted: true,
    navigationState: { current: "location", highlighted: true },
    openedDetails: false,
    pillTitle: "Architecture Talk",
    selected: true,
  });
});

test("event search supports exploration before the user knows what to type", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: { id: "arts-centre", label: "Arts Centre", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "concert", title: "Evening Jazz Concert", venue: "Concert Hall", dateText: "14 Jul 2026" },
        { id: "workshop", title: "Family Art Workshop", venue: "Gallery", dateText: "15 Jul 2026" },
      ],
    });
    const search = createLandmarkEventSearch({
      categories: ["Performances", "Workshops & Classes"],
      onFilter: (filters) => layer.setFilters(filters),
    });
    search.input.focus();
    const initial = {
      expanded: search.input.getAttribute("aria-expanded"),
      heading: document.querySelector(".landmark-event-search__results-title")?.textContent,
      count: document.querySelector(".landmark-event-search__results-count")?.textContent,
      results: [...document.querySelectorAll(".landmark-event-search__result strong")].map((node) => node.textContent),
      sameWidthAsInput: Math.abs(
        search.input.getBoundingClientRect().width - document.querySelector(".landmark-event-search__results").getBoundingClientRect().width,
      ) < 0.5,
    };
    document.querySelector('[aria-label="Workshops & Classes"]').click();
    const filtered = {
      heading: document.querySelector(".landmark-event-search__results-title")?.textContent,
      results: [...document.querySelectorAll(".landmark-event-search__result strong")].map((node) => node.textContent),
    };
    search.destroy();
    layer.destroy();
    return { filtered, initial };
  });
  expect(result).toEqual({
    initial: {
      expanded: "true",
      heading: "Closest to this view",
      count: "2 found",
      results: ["Evening Jazz Concert", "Family Art Workshop"],
      sameWidthAsInput: true,
    },
    filtered: { heading: "Workshops & Classes nearest first", results: ["Family Art Workshop"] },
  });
});

test("dismissed event search stays closed during refresh and reopens on user input", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    const item = { id: "concert", title: "Evening Jazz Concert", venue: "Concert Hall" };
    const search = createLandmarkEventSearch({
      onFilter: ({ query }) => ({ matchedEvents: 1, query: query.trim(), results: [item] }),
    });
    search.input.focus();
    document.querySelector(".landmark-event-search__result").click();
    search.refresh();
    const afterRefresh = search.input.getAttribute("aria-expanded");
    search.input.value = "jazz";
    search.input.dispatchEvent(new Event("input"));
    const afterInput = search.input.getAttribute("aria-expanded");
    window.dispatchEvent(new CustomEvent("whats-here:overlay-open", { detail: { id: "restaurants" } }));
    const afterOtherOverlay = search.input.getAttribute("aria-expanded");
    search.destroy();
    return { afterInput, afterOtherOverlay, afterRefresh };
  });
  expect(state).toEqual({ afterInput: "true", afterOtherOverlay: "false", afterRefresh: "false" });
});

test("event results stay nearest-first and refresh after the map center changes", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    let center = { lng: 103.85, lat: 1.29 };
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getCenter: () => center,
      getZoom: () => 17,
      project: ([lng, lat]) => ({ x: (lng - center.lng) * 10000 + 640, y: (center.lat - lat) * 10000 + 360 }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: { id: "far", label: "Far Venue", anchor: { lng: 103.9, lat: 1.29 } },
      sourceEvents: [{ title: "Far Event", dateText: "14 Jul 2026" }],
    });
    layer.add({
      landmark: { id: "near", label: "Near Venue", anchor: { lng: 103.851, lat: 1.29 } },
      sourceEvents: [{ title: "Near Event", dateText: "14 Jul 2026" }],
    });
    const search = createLandmarkEventSearch({ onFilter: (filters) => layer.setFilters(filters) });
    const titles = () => [...document.querySelectorAll(".landmark-event-search__result strong")].map((node) => node.textContent);
    search.input.focus();
    const initial = titles();
    center = { lng: 103.9, lat: 1.29 };
    search.refresh();
    const afterMove = titles();
    search.destroy();
    layer.destroy();
    return { afterMove, initial };
  });
  expect(result).toEqual({ afterMove: ["Far Event", "Near Event"], initial: ["Near Event", "Far Event"] });
});

test("event search lazily reveals every result while scrolling", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventSearch } = await import("/activity-scenes/landmark-event-search.js");
    const items = Array.from({ length: 18 }, (_, index) => ({
      category: "Exhibitions",
      date: `Day ${index + 1}`,
      inView: true,
      title: `Event ${index + 1}`,
      venue: "Gallery",
    }));
    const search = createLandmarkEventSearch({
      onFilter: () => ({ matchedEvents: items.length, query: "", results: items }),
    });
    search.input.focus();
    const panel = document.getElementById("landmark-event-search-results");
    const count = () => panel.querySelectorAll(".landmark-event-search__result").length;
    const batches = [count()];
    panel.scrollTop = panel.scrollHeight;
    panel.dispatchEvent(new Event("scroll"));
    batches.push(count());
    panel.scrollTop = panel.scrollHeight;
    panel.dispatchEvent(new Event("scroll"));
    batches.push(count());
    const hintCount = panel.querySelectorAll(".landmark-event-search__results-hint").length;
    search.destroy();
    return { batches, hintCount };
  });
  expect(result).toEqual({ batches: [8, 16, 18], hintCount: 0 });
});

test("selected location arrow becomes a pill highlight when its target enters the viewport", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkDirectionIndicator } = await import("/activity-scenes/landmark-direction-indicator.js");
    let projected = { x: 1600, y: 360 };
    let zoom = 12;
    const zoomMoves = [];
    let visibleLandmark = null;
    const map = {
      easeTo: (options) => { zoomMoves.push(options); zoom = options.zoom; },
      getZoom: () => zoom,
      project: () => projected,
    };
    const indicator = createLandmarkDirectionIndicator(map, { onVisible: (landmark) => { visibleLandmark = landmark.label; } });
    indicator.setTarget({ label: "Arts Centre", anchor: { lng: 1, lat: 1 } });
    const arrow = document.querySelector(".landmark-direction-indicator");
    const arrowIcon = arrow.querySelector(".landmark-direction-indicator__arrow");
    const offscreen = {
      hidden: arrow.hidden,
      icon: arrowIcon.className,
      label: arrow.getAttribute("aria-label"),
      rightMargin: Math.round(window.innerWidth - arrow.getBoundingClientRect().right),
    };
    indicator.setTarget({ label: "VICTORIA THEATRE AND CONCERT HALL (U/C)", anchor: { lng: 1, lat: 1 } });
    const longLabel = arrow.querySelector(".landmark-direction-indicator__label");
    const fittedLongLabel = {
      fits: longLabel.scrollWidth <= longLabel.clientWidth && longLabel.scrollHeight <= longLabel.clientHeight,
      reduced: Number.parseFloat(getComputedStyle(longLabel).fontSize) < 13,
      width: Math.round(arrow.getBoundingClientRect().width),
    };
    indicator.setTarget({ label: "Arts Centre", anchor: { lng: 1, lat: 1 } });
    projected = { x: 220, y: 240 };
    indicator.update();
    const onscreen = { hidden: arrow.hidden, visibleLandmark };
    projected = { x: -100, y: 300 };
    indicator.update();
    const movedAway = { hidden: arrow.hidden };
    indicator.destroy();
    return { fittedLongLabel, movedAway, offscreen, onscreen, zoomMoves };
  });
  expect(state).toEqual({
    fittedLongLabel: { fits: true, reduced: true, width: 240 },
    movedAway: { hidden: true },
    offscreen: {
      hidden: false,
      icon: "ph-bold ph-arrow-up landmark-direction-indicator__arrow",
      label: "Show Arts Centre on map",
      rightMargin: 24,
    },
    onscreen: { hidden: true, visibleLandmark: "Arts Centre" },
    zoomMoves: [{ zoom: 16.65, duration: 700 }],
  });
});

test("pill and direction positioning stay idle until the map changes", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkDirectionIndicator } = await import("/activity-scenes/landmark-direction-indicator.js");
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const listeners = new Map();
    const on = (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    };
    const off = (name, listener) => listeners.get(name)?.delete(listener);
    const emit = (name) => listeners.get(name)?.forEach((listener) => listener());
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      on,
      off,
      project: ([lng]) => lng === 2 ? { x: 1600, y: 300 } : { x: 200, y: 200 },
    };
    const pills = createLandmarkEventPillLayer({ map, panelId: "panel", rotationMs: 10_000 });
    pills.add({
      landmark: { id: "idle-pill", label: "Idle pill", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "idle-event", title: "Idle event", dateText: "14 Jul 2026" }],
    });
    const direction = createLandmarkDirectionIndicator(map);
    direction.setTarget({ id: "idle-direction", label: "Idle direction", anchor: { lng: 2, lat: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const readCounts = () => ({
      direction: Number(document.body.dataset.landmarkDirectionUpdateCount || 0),
      pillPasses: Number(document.body.dataset.landmarkEventPillPositionPassCount || 0),
    });
    const beforeIdle = readCounts();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterIdle = readCounts();
    emit("move");
    emit("move");
    emit("zoom");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterMovement = readCounts();
    pills.destroy();
    direction.destroy();
    return {
      idleDirectionUpdates: afterIdle.direction - beforeIdle.direction,
      idlePillPasses: afterIdle.pillPasses - beforeIdle.pillPasses,
      movementDirectionUpdates: afterMovement.direction - afterIdle.direction,
      movementPillPasses: afterMovement.pillPasses - afterIdle.pillPasses,
    };
  });
  expect(result).toEqual({
    idleDirectionUpdates: 0,
    idlePillPasses: 0,
    movementDirectionUpdates: 1,
    movementPillPasses: 1,
  });
});

test("hidden pills leave keyboard navigation", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    let zoom = 17;
    let hiddenCalls = 0;
    const listeners = new Map();
    const focusTarget = document.getElementById("map-focus");
    const map = {
      getCanvas: () => focusTarget,
      getZoom: () => zoom,
      on: (name, listener) => listeners.set(name, listener),
      off: (name) => listeners.delete(name),
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({ map, onHidden: () => { hiddenCalls += 1; }, panelId: "panel" });
    layer.add({
      landmark: { id: "test", label: "Test", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "event", title: "Event", dateText: "12 Jul 2026" }],
    });
    const card = document.querySelector(".landmark-event-pill__card");
    card.focus();
    zoom = 15;
    listeners.get("zoom")?.();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = {
      ariaHidden: card.parentElement.getAttribute("aria-hidden"),
      focused: document.activeElement?.id,
      hiddenCalls,
      tabIndex: card.tabIndex,
    };
    layer.destroy();
    return result;
  });
  expect(state).toEqual({ ariaHidden: "true", focused: "map-focus", hiddenCalls: 1, tabIndex: -1 });
});

test("hidden pills cannot be selected with a pointer", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    let selections = 0;
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 15,
      on: () => {},
      off: () => {},
      project: () => ({ x: 200, y: 200 }),
    };
    window.__hiddenPillLayer = createLandmarkEventPillLayer({
      map,
      onSelect: () => { selections += 1; },
      panelId: "panel",
    });
    window.__hiddenPillSelections = () => selections;
    window.__hiddenPillLayer.add({
      landmark: { id: "hidden-pointer", label: "Hidden pointer", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "event", title: "Hidden event", dateText: "12 Jul 2026" }],
    });
  });

  const pill = page.locator("#hidden-pointer-event-pill");
  await expect(pill).toHaveAttribute("aria-hidden", "true");
  const cardBox = await pill.locator(".landmark-event-pill__card").boundingBox();
  expect(cardBox).not.toBeNull();
  await page.mouse.click(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await expect.poll(() => page.evaluate(() => window.__hiddenPillSelections())).toBe(0);

  await page.evaluate(() => window.__hiddenPillLayer.destroy());
});

test("pill rotates events every three seconds without a progress indicator", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel", rotationMs: 60 });
    layer.add({
      landmark: { id: "rotation", label: "Rotation", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "first", title: "First option", dateText: "12 Jul 2026" },
        { id: "second", title: "Second option", dateText: "13 Jul 2026" },
      ],
    });
    const card = document.querySelector(".landmark-event-pill__card");
    card.dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    const state = {
      hasDots: Boolean(document.querySelector(".landmark-event-pill__dots")),
      hasExpandedList: Boolean(document.querySelector(".landmark-event-pill__expanded")),
      hasMeta: Boolean(document.querySelector(".landmark-event-pill__meta")),
      titleWhiteSpace: getComputedStyle(document.querySelector(".landmark-event-pill__title")).whiteSpace,
      title: document.querySelector(".landmark-event-pill__title").textContent,
    };
    layer.destroy();
    return state;
  });
  expect(result).toEqual({
    hasDots: false,
    hasExpandedList: false,
    hasMeta: false,
    titleWhiteSpace: "normal",
    title: "Second option",
  });
});

test("short pill titles center and shrink while preserving the existing maximum width", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: { id: "compact", label: "Compact", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "event", title: "Common Room", dateText: "14 Jul 2026" }],
    });
    const root = document.querySelector(".landmark-event-pill");
    const card = root.querySelector(".landmark-event-pill__card");
    const title = root.querySelector(".landmark-event-pill__title");
    const state = {
      cardWidth: card.getBoundingClientRect().width,
      maxWidth: root.getBoundingClientRect().width,
      textAlign: getComputedStyle(title).textAlign,
    };
    layer.destroy();
    return state;
  });
  expect(result.textAlign).toBe("center");
  expect(result.cardWidth).toBeLessThan(result.maxWidth);
  expect(result.maxWidth).toBe(220);
});

test("singleton panel remains safe for existing consumers", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const first = createLandmarkEventPanel();
    const second = createLandmarkEventPanel();
    const trigger = document.getElementById("map-focus");
    first.open({
      landmark: { id: "test", label: "Test" },
      sourceEvents: [{ id: "event", title: "Event", dateText: "12 Jul 2026" }],
      trigger,
    });
    const result = { connected: document.getElementById(first.id)?.isConnected, same: first === second };
    second.destroy();
    return result;
  });
  expect(state).toEqual({ connected: true, same: true });
});

test("event titles render as plain text in both pill and panel", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
    });
    const landmark = { id: "text-sanitize", label: "Text Sanitize", anchor: { lng: 1, lat: 1 } };
    layer.add({
      landmark,
      sourceEvents: [
        { id: "event-1", title: "<p>Fish &amp; Chips</p>", dateText: "12 Jul 2026", eventUrl: "https://example.com/fish" },
      ],
    });
    const pillTitle = document.querySelector(".landmark-event-pill__title");
    pillTitle.closest(".landmark-event-pill__card").click();
    const panelTitle = document.querySelector(".landmark-event-panel__event-title");
    const result = {
      eventNavigationHidden: document.querySelector(".landmark-event-panel__events").hidden,
      pillText: pillTitle.textContent,
      pillHtml: pillTitle.innerHTML,
      panelText: panelTitle.textContent,
      panelHtml: panelTitle.innerHTML,
      viewEventVisible: !document.querySelector(".landmark-event-panel__link").hidden,
    };
    layer.destroy();
    panel.destroy();
    return result;
  });
  expect(result).toEqual({
    eventNavigationHidden: true,
    pillText: "Fish & Chips",
    pillHtml: "Fish &amp; Chips",
    panelText: "Fish & Chips",
    panelHtml: "Fish &amp; Chips",
    viewEventVisible: true,
  });
});

test("successful snapshots refresh pills and the open panel while partial snapshots preserve them", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 200, y: 200 }) };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
      onEventsChanged: (change) => panel.refresh(change),
    });
    const alpha = { id: "alpha", label: "Alpha", anchor: { lng: 1, lat: 1 } };
    const beta = { id: "beta", label: "Beta", anchor: { lng: 2, lat: 2 } };
    layer.reconcile({ runStatus: "success", landmarks: [
      { landmark: alpha, sourceEvents: [{ id: "a1", title: "Old title", dateText: "12 Jul" }] },
      { landmark: beta, sourceEvents: [{ id: "b1", title: "Beta event", dateText: "12 Jul" }] },
    ] });
    document.querySelector("#alpha-event-pill .landmark-event-pill__card").click();
    const partialAccepted = layer.reconcile({ runStatus: "partial", landmarks: [
      { landmark: alpha, sourceEvents: [{ id: "a2", title: "Partial title", dateText: "13 Jul" }] },
    ] });
    const afterPartial = document.querySelector(".landmark-event-panel__event-title").textContent;
    layer.reconcile({ runStatus: "success", landmarks: [
      { landmark: alpha, sourceEvents: [
        { id: "a1", title: "Updated title", dateText: "12 Jul" },
        { id: "a2", title: "New event", dateText: "13 Jul" },
      ] },
    ] });
    const afterSuccess = document.querySelector(".landmark-event-panel__event-title").textContent;
    const eventCount = Number(document.querySelector(".landmark-event-panel__event-position").textContent.match(/of (\d+)/)?.[1]);
    const betaRemoved = !document.getElementById("beta-event-pill");
    const alphaCount = document.querySelectorAll("#alpha-event-pill").length;
    layer.reconcile({ runStatus: "success", landmarks: [] });
    const closedAfterRemoval = document.getElementById(panel.id).hidden;
    layer.destroy();
    panel.destroy();
    return { afterPartial, afterSuccess, alphaCount, betaRemoved, closedAfterRemoval, eventCount, partialAccepted };
  });
  expect(result).toEqual({
    afterPartial: "Old title",
    afterSuccess: "Updated title",
    alphaCount: 1,
    betaRemoved: true,
    closedAfterRemoval: true,
    eventCount: 2,
    partialAccepted: false,
  });
});

test("panel sorts canonically, isolates gestures, and rejects invalid details", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    trigger.setAttribute("aria-expanded", "false");
    const panel = createLandmarkEventPanel();
    panel.open({
      landmark: { id: "test", label: "Verified Landmark" },
      sourceEvents: [
        { id: "late", title: "Late", startDateTime: "2026-07-13T19:00:00+08:00", dateText: "13 Jul 2026", venueVerified: true },
        { id: "missing-title", startDateTime: "2026-07-11T19:00:00+08:00" },
        { id: "early", title: "Early", startDateTime: "2026-07-12T19:00:00+08:00", dateText: "12 Jul 2026", eventUrl: "javascript:bad" },
      ],
      selectedEventIndex: 0,
      trigger,
    });
    const selected = document.querySelector(".landmark-event-panel__event-title")?.textContent;
    const position = document.querySelector(".landmark-event-panel__event-position")?.textContent;
    const venue = document.querySelector(".landmark-event-panel__field--venue dd")?.textContent;
    let bubbledWheels = 0;
    document.addEventListener("wheel", () => { bubbledWheels += 1; }, { once: true });
    document.getElementById(panel.id).dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const unavailableLink = document.querySelector(".landmark-event-panel__link");
    const iconClasses = [...document.querySelectorAll(".landmark-event-panel__actions .ph-bold")].map((icon) => icon.className);
    const eventNav = [...document.querySelectorAll(".landmark-event-panel__event-nav")].map((button) => ({
      icon: button.querySelector(".ph-bold")?.className,
      label: button.getAttribute("aria-label"),
    }));
    panel.destroy();
    return { bubbledWheels, eventNav, iconClasses, position, selected, unavailableLink: unavailableLink?.hidden === false, venue };
  });
  expect(result).toEqual({
    bubbledWheels: 0,
    eventNav: [
      { icon: "ph-bold ph-arrow-left", label: "Previous event" },
      { icon: "ph-bold ph-arrow-right", label: "Next event" },
    ],
    iconClasses: ["ph-bold ph-list-plus", "ph-bold ph-arrow-square-out", "ph-bold ph-navigation-arrow", "ph-bold ph-x"],
    position: "2 of 2 events",
    selected: "Late",
    unavailableLink: false,
    venue: "Verified Landmark",
  });
});

test("event panel renders the complete display contract and only exposes validated official links", async ({ page }) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    const panel = createLandmarkEventPanel();
    panel.open({
      landmark: { id: "venue", label: "Verified Venue", anchor: { lat: 1.29, lng: 103.85 } },
      sourceEvents: [{
        id: "one", title: "Complete details", dateText: "14 Jul 2026", eventUrl: "https://example.com/official",
        sources: [{ source: "Catch.sg", sourceUrl: "https://example.com/official" }],
      }],
      trigger,
    });
    const fieldsWithLink = Object.fromEntries([...document.querySelectorAll(".landmark-event-panel__field")].map((row) => [
      row.querySelector("dt").textContent, row.querySelector("dd").textContent,
    ]));
    const descriptionWithLink = document.querySelector(".landmark-event-panel__description-copy").textContent;
    const link = document.querySelector(".landmark-event-panel__link");
    const officialLink = { hidden: link.hidden, href: link.href };
    const directions = document.querySelector(".landmark-event-panel__directions");
    const directionsLink = { hidden: directions.hidden, href: directions.href };
    const header = {
      backLabel: document.querySelector(".landmark-event-panel__back")?.getAttribute("aria-label"),
      hasUpcomingEventsKicker: Boolean(document.querySelector(".landmark-event-panel__kicker")),
      placeName: document.querySelector(".landmark-event-panel__heading")?.textContent,
    };
    const detailStyle = getComputedStyle(document.querySelector(".landmark-event-panel__details"));
    const eventContentPadding = { left: detailStyle.paddingLeft, top: detailStyle.paddingTop };
    panel.open({
      landmark: { id: "venue", label: "Verified Venue" },
      sourceEvents: [{ id: "two", title: "No official link", eventUrl: "javascript:alert(1)" }],
      trigger,
    });
    const invalidLinkHidden = link.hidden;
    const directionsHiddenWithoutCoordinates = directions.hidden;
    const singletonCount = document.querySelectorAll("#landmark-event-panel").length;
    const actionLabels = [...document.querySelectorAll(".landmark-event-panel__actions [aria-label]")].map((element) => element.getAttribute("aria-label"));
    document.querySelector(".landmark-event-panel__back").click();
    const backClosedPanel = document.getElementById(panel.id).hidden;
    const backRestoredFocus = document.activeElement === trigger;
    panel.destroy();
    return { actionLabels, backClosedPanel, backRestoredFocus, descriptionWithLink, directionsHiddenWithoutCoordinates, directionsLink, eventContentPadding, fieldsWithLink, header, invalidLinkHidden, officialLink, singletonCount };
  });
  expect(result).toEqual({
    actionLabels: ["Add event to plan", "View event website", "Get directions to venue", "Close event details"],
    backClosedPanel: true,
    backRestoredFocus: true,
    descriptionWithLink: "Not available",
    directionsHiddenWithoutCoordinates: true,
    directionsLink: { hidden: false, href: "https://www.google.com/maps/dir/?api=1&destination=1.29%2C103.85" },
    eventContentPadding: { left: "28px", top: "28px" },
    fieldsWithLink: {
      Reference: "Catch.sg",
      Date: "14 Jul 2026", Time: "Not available", Venue: "Not available", Address: "Not available",
      Category: "Not available", Price: "Not available", Organizer: "Not available",
    },
    header: { backLabel: "Back to events", hasUpcomingEventsKicker: false, placeName: "Verified Venue" },
    invalidLinkHidden: true,
    officialLink: { hidden: false, href: "https://example.com/official" },
    singletonCount: 1,
  });
});

test("shared pill edge clamp and panel remain usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/test-harness.html");
  const bounds = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } = await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } = await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = { getCanvas: () => document.getElementById("map-focus"), getZoom: () => 17, project: () => ({ x: 5, y: 300 }) };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
    });
    layer.add({
      landmark: { id: "edge", label: "Edge", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [{ id: "edge-event", title: "Edge event", dateText: "12 Jul 2026" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector(".landmark-event-pill__card").click();
    const card = document.querySelector(".landmark-event-pill__card").getBoundingClientRect();
    const panelRect = document.getElementById(panel.id).getBoundingClientRect();
    const result = { cardLeft: card.left, cardRight: card.right, panelLeft: panelRect.left, panelRight: panelRect.right };
    layer.destroy();
    panel.destroy();
    return result;
  });
  expect(bounds.cardLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.cardRight).toBeLessThanOrEqual(390);
  expect(bounds.panelLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.panelRight).toBeLessThanOrEqual(390);
});
