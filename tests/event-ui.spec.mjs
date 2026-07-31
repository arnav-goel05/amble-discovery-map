import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const approvedLandmarksFixture = JSON.parse(
  readFileSync(
    new URL("../data/snapshots/initial/landmarks.json", import.meta.url),
  ),
);
const sampanLandmarkFixture = approvedLandmarksFixture.find((landmark) =>
  landmark.events?.some((event) => event.title.includes("Sampan Rides")),
);
const approvedPoisFixture = JSON.parse(
  readFileSync(new URL("../data/snapshots/initial/pois.json", import.meta.url)),
);
const backgroundGeometryRelease = JSON.parse(
  readFileSync(
    new URL("../data/background-geometry-release.json", import.meta.url),
  ),
);
const sampanPoiFixture = approvedPoisFixture.find(
  (poi) => poi.id === sampanLandmarkFixture.id,
);

test("empty approved snapshot renders no highlights, pills, or panels", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => {
    if (
      error.message !== "Failed to fetch" &&
      !error.message.includes(
        "cloudflareinsights.com/cdn-cgi/rum due to access control checks",
      )
    )
      errors.push(error.message);
  });
  await page.goto(
    "/?autoStart&emptyApprovedSnapshot&rawTiles#8/1.285844/103.857897/-30/60",
  );
  await expect(page.locator("#warning")).toHaveCount(0);
  await expect
    .poll(
      () => page.locator("body").getAttribute("data-poi-highlight-manager"),
      { timeout: 15_000 },
    )
    .toBe("combined");
  await expect(page.locator('[id^="poi-"][id$="-3d"]')).toHaveCount(0);
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-panel")).toHaveCount(1);
  await expect(page.locator("#landmark-event-panel")).toBeHidden();
  await expect(
    page.locator(
      ".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .maplibregl-ctrl-compass",
    ),
  ).toHaveCount(0);
  await expect(page.locator("#map-guidance")).toBeVisible();
  await expect(page.locator(".app-brand")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-tile-error-count",
    /[1-9]/,
  );
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-poi-tile-error-count",
    /[1-9]/,
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-preload",
    "disabled",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-preload-count",
    "0",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-active-layer-count",
    "0",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-configured-layer-count",
    "0",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-background-maximum-screen-space-error",
    "4",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-default-maximum-screen-space-error",
    "4",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-background-tileset-url",
    backgroundGeometryRelease.tilesetUrl,
  );
  expect(errors).toEqual([]);

  await page.evaluate(() => window._map.remove());
  await expect(page.locator(".landmark-event-pill")).toHaveCount(0);
  await expect(page.locator("#landmark-event-panel")).toHaveCount(0);
});

test("clicking the map dismisses whichever side panel is open", async ({
  page,
}) => {
  await page.goto(
    "/?autoStart&emptyApprovedSnapshot#17/1.285844/103.857897/-30/60",
  );
  await expect
    .poll(() => page.locator("body").getAttribute("data-plan-builder"))
    .toBe("mounted");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("whats-here:add-to-plan", {
        detail: {
          id: "map-dismiss-stop",
          type: "event",
          title: "Map dismiss test",
          place: "Esplanade",
          latitude: 1.2897,
          longitude: 103.8559,
        },
      }),
    ),
  );
  await expect(page.locator("#plan-builder")).toBeVisible();
  await page
    .locator(".maplibregl-canvas")
    .dispatchEvent("click", { button: 0 });
  await expect(page.locator("#plan-builder")).toBeHidden();
});

test("legacy demo landmarks are not mounted", async ({ page }) => {
  await page.goto("/?autoStart&demoLandmarks#17/1.285844/103.857897/-30/60");
  await expect(
    page.getByRole("button", {
      name: /Lau Pa Sat|Fullerton Hotel|National Gallery/i,
    }),
  ).toHaveCount(0);
  await expect(page.locator('[id^="demo:"]')).toHaveCount(0);
});

test("location focus zooms in from a wide view without zooming out a close view", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { focusMapLocation, zoomMapToMinimum } =
      await import("/activity-scenes/map-location-focus.js");
    const recorded = [];
    const map = {
      getZoom: () => 12,
      easeTo: (options) => recorded.push(options),
    };
    const zoomedToPills = zoomMapToMinimum(map);
    focusMapLocation(map, { lat: 1.29, lng: 103.85 });
    map.getZoom = () => 18;
    const preservedCloseZoom = zoomMapToMinimum(map);
    focusMapLocation(
      map,
      { latitude: 1.3, longitude: 103.86 },
      { duration: 500 },
    );
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

test("bottom-left map guidance exposes working zoom and rotation controls", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const actions = await page.evaluate(async () => {
    const { addMapGuidanceControls } =
      await import("/activity-scenes/map-guidance-controls.js");
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
    const attributionButton = document.querySelector(
      '[aria-label="Map information and attribution"]',
    );
    attributionButton.click();
    const attribution = {
      expanded: attributionButton.getAttribute("aria-expanded"),
      links: [...document.querySelectorAll(".map-attribution-details a")].map(
        (link) => link.textContent,
      ),
      visible: !document.querySelector(".map-attribution-details").hidden,
    };
    const icons = [...document.querySelectorAll(".map-guidance i")].map(
      (icon) => icon.className,
    );
    controls.finalize();
    return { attribution, calls, icons };
  });
  expect(actions).toEqual({
    attribution: {
      expanded: "true",
      links: ["OpenStreetMap", "CARTO", "SLA", "OneMap"],
      visible: true,
    },
    calls: [
      ["in", { duration: 300 }],
      ["out", { duration: 300 }],
      ["rotate", { bearing: 60, duration: 450 }],
    ],
    icons: [
      "ph-bold ph-plus",
      "ph-bold ph-minus",
      "ph-bold ph-arrow-clockwise",
      "ph-bold ph-question",
      "ph-bold ph-info",
    ],
  });
});

test("search selection centers the event pill without a redundant direction pointer", async ({
  page,
}) => {
  await page.addInitScript(
    (snapshot) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
    },
    {
      pois: [sampanPoiFixture],
      landmarks: [sampanLandmarkFixture],
      backgroundTilesetUrl: "poi-tiles/wisma-geylang-serai/tileset.json",
      poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
    },
  );
  await page.goto("/?autoStart#12/1.34/103.70/0/0");
  await expect
    .poll(
      () => page.locator("body").getAttribute("data-landmark-event-pills"),
      { timeout: 30_000 },
    )
    .toBe("mounted");
  await page.locator("#landmark-event-search-input").fill("Sampan Rides");
  await page
    .locator(".landmark-event-search__result", { hasText: "Sampan Rides" })
    .evaluate((button) => button.click());
  await expect(page.locator("#landmark-event-search-results")).toBeHidden();
  const selectedLandmarkId = await page
    .locator("body")
    .getAttribute("data-poi-selected-layer-id");
  expect(selectedLandmarkId).toBeTruthy();
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-selected-maximum-screen-space-error",
    "4",
  );
  expect(
    await page.evaluate(() => Boolean(window._map.getLayer("event-venues-3d"))),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        Object.keys(window._map.style?._layers || {}).filter((id) =>
          /^poi-.+-3d$/.test(id),
        ).length,
    ),
  ).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window._map.getZoom()))
    .toBeGreaterThanOrEqual(16.9);
  await expect
    .poll(
      () => page.locator("body").getAttribute("data-tile-refinement-state"),
      { timeout: 20_000 },
    )
    .toBe("full-detail");
  await expect(page.locator("body")).toHaveAttribute(
    "data-background-current-maximum-screen-space-error",
    "4",
  );
  await expect(page.locator(".landmark-direction-indicator")).toHaveCount(0);
  await expect(
    page.locator(
      ".landmark-event-pill.is-navigation-target .landmark-event-pill__card",
    ),
  ).toBeVisible();
  await expect(page.locator("#landmark-event-search-results")).toBeHidden();
  await expect
    .poll(
      async () =>
        (await page
          .locator("body")
          .getAttribute("data-poi-active-layer-screen-space-errors")) || "",
    )
    .toContain("event-venues-3d:4");
  await expect(page.locator("body")).toHaveAttribute(
    "data-poi-combined-tileset-loaded",
    "true",
  );
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-poi-tile-error-count",
    /[1-9]/,
  );
  const center = await page.evaluate(() => window._map.getCenter().toArray());
  expect(center[0]).toBeCloseTo(103.8589, 2);
  expect(center[1]).toBeCloseTo(1.2841, 2);
});

test("event filter typing offers local free-text commit without outlined text", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: {
        id: "library",
        label: "National Library",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        {
          id: "journey",
          title: "Journey to the West",
          venue: "Drama Centre",
          dateText: "14 Jul 2026",
        },
      ],
    });
    const search = createLandmarkEventSearch({
      categories: ["Performances"],
      onFilter: (filters) => layer.setFilters(filters),
    });
    const input = search.input;
    input.focus();
    const before = document
      .querySelector(".landmark-event-pill")
      .getAttribute("aria-hidden");
    input.value = "opera";
    input.dispatchEvent(new Event("input"));
    const noOptions = document.querySelector(
      ".landmark-event-search__no-options",
    );
    const noOptionsStyle = getComputedStyle(noOptions);
    const state = {
      after: document
        .querySelector(".landmark-event-pill")
        .getAttribute("aria-hidden"),
      before,
      noOptions: noOptions?.textContent,
      noOptionsTypography: {
        backgroundImage: noOptionsStyle.backgroundImage,
        textFillColor: noOptionsStyle.webkitTextFillColor,
        textShadow: noOptionsStyle.textShadow,
        textStrokeWidth: noOptionsStyle.webkitTextStrokeWidth,
      },
      status: document.querySelector(".landmark-event-search__status")
        .textContent,
      submitButtonCount: document.querySelectorAll(
        ".landmark-event-search__submit",
      ).length,
    };
    search.destroy();
    layer.destroy();
    return state;
  });
  expect(result).toEqual({
    after: "false",
    before: "false",
    noOptions: "Press Enter to search for “opera”.",
    noOptionsTypography: {
      backgroundImage: "none",
      textFillColor: "rgb(82, 96, 111)",
      textShadow: "none",
      textStrokeWidth: "0px",
    },
    status: "",
    submitButtonCount: 0,
  });
});

test("event filter typing detects a suitable dimension and supports deviations", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    globalThis.__guidedSearch = createLandmarkEventSearch({
      categories: ["Performances"],
      onFilter: (filters) => ({
        matchedEvents: 0,
        query: filters.query,
        results: [],
      }),
    });
  });
  const input = page.locator("#landmark-event-search-input");
  await input.focus();
  await expect(
    page.locator('[data-filter-option-id="what:performances"]'),
  ).toBeVisible();
  await page.locator('[data-filter-dimension="where"]').click();
  await expect(input).toHaveAttribute("placeholder", "Search Where");
  await input.fill("today");
  await expect(
    page.locator('[data-filter-option-id="when:today"]'),
  ).toBeVisible();
  await expect(
    page.locator(".landmark-event-search__option-group-heading"),
  ).toHaveText("When");

  await input.fill("");
  await page.locator('[data-filter-dimension="what"]').click();
  await expect(page.locator('[data-filter-dimension="what"]')).toHaveAttribute(
    "aria-current",
    "step",
  );
  await page.evaluate(() => globalThis.__guidedSearch.destroy());
});

test("selected dimensions stay hidden until removed from their phrase editor", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    globalThis.__guidedSearch = createLandmarkEventSearch({
      categories: ["Exhibitions"],
      onFilter: (filters) => ({
        matchedEvents: 0,
        query: filters.query,
        results: [],
      }),
    });
  });
  const input = page.locator("#landmark-event-search-input");
  await input.focus();
  await page.locator('[data-filter-dimension="when"]').click();
  await page.locator('[data-filter-option-id="when:today"]').click();
  await expect(page.locator('[data-filter-dimension="when"]')).toHaveCount(0);
  const phrase = page.locator('[data-filter-token-id="when:today"]');
  await expect(phrase).not.toHaveCSS("border-top-style", "solid");
  await phrase.click();
  await expect(page.locator('[data-filter-dimension="when"]')).toBeVisible();
  await page.getByRole("button", { name: "Remove selection" }).click();
  await expect(phrase).toHaveCount(0);
  await expect(page.locator('[data-filter-dimension="when"]')).toBeVisible();
  await page.evaluate(() => globalThis.__guidedSearch.destroy());
});

test("sentence composer classifies a full request locally and renders bold phrases", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const discoveryModel = {
      filterOptions: () => ({
        categories: ["Workshops & Classes"],
        locations: [
          {
            id: "venue:esplanade",
            kind: "venue",
            value: "Esplanade",
            label: "Esplanade",
            availableCount: 4,
          },
        ],
      }),
      filter: (filters) => {
        globalThis.__sentenceFilterCalls ??= [];
        globalThis.__sentenceFilterCalls.push(filters);
        return { matchedEvents: 0, query: filters.query, results: [] };
      },
    };
    globalThis.__sentenceSearch = createLandmarkEventSearch({
      discoveryModel,
    });
  });
  const input = page.locator("#landmark-event-search-input");
  await input.fill(
    "Find workshops this weekend near Esplanade under $25 romantic",
  );
  await input.press("Enter");
  await expect(page.locator(".landmark-event-search__token")).toHaveCount(5);
  await expect(page.locator(".landmark-event-search__token strong")).toHaveText(
    [
      "Workshops & Classes",
      "This weekend",
      "Esplanade",
      "Under $25",
      "romantic",
    ],
  );
  await expect(page.locator(".landmark-event-search__token i")).toHaveCount(0);
  const state = await page.evaluate(() => {
    const tokenStyle = getComputedStyle(
      document.querySelector(".landmark-event-search__token"),
    );
    return {
      filters: globalThis.__sentenceFilterCalls.find(
        ({ priceRange }) => priceRange === "under-25",
      ),
      requests: performance
        .getEntriesByType("resource")
        .filter(({ name }) => /openai|chatgpt/i.test(name)).length,
      tokenStyle: {
        backgroundColor: tokenStyle.backgroundColor,
        borderTopStyle: tokenStyle.borderTopStyle,
      },
    };
  });
  expect(state.filters).toMatchObject({
    categories: ["Workshops & Classes"],
    dateRange: "this-weekend",
    priceRange: "under-25",
    query: "romantic",
    where: { kind: "venue", venueKey: "esplanade" },
  });
  expect(state.requests).toBe(0);
  expect(state.tokenStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(state.tokenStyle.borderTopStyle).toBe("none");
  await page.evaluate(() => globalThis.__sentenceSearch.destroy());
});

test("event filter shows selectable results and inclusive What options", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    let selection = null;
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: "panel",
      onSelect: (value) => {
        selection = value;
      },
    });
    layer.add({
      landmark: {
        id: "arts-centre",
        label: "Arts Centre",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        {
          id: "concert",
          title: "Evening Jazz Concert",
          venue: "Concert Hall",
          dateText: "14 Jul 2026",
        },
        {
          id: "talk",
          title: "Architecture Talk",
          venue: "Studio",
          dateText: "15 Jul 2026",
        },
      ],
    });
    const search = createLandmarkEventSearch({
      categories: layer.categories(),
      onFilter: (filters) => layer.setFilters(filters),
      onResultSelect: (item) => layer.selectResult(item),
    });
    search.input.focus();
    const resultTitle = document.querySelector(
      ".landmark-event-search__result strong",
    )?.textContent;
    document.querySelector(".landmark-event-search__result")?.click();
    search.input.focus();
    document.querySelector('[data-filter-dimension="what"]')?.click();
    const categoryButtons = [
      ...document.querySelectorAll('[data-filter-option-id^="what:"]'),
    ];
    const categories = categoryButtons.map(
      (node) => node.querySelector("strong")?.textContent,
    );
    const thumbnails = categoryButtons.map((node) =>
      node
        .querySelector(".landmark-event-search__thumbnail img")
        ?.getAttribute("src"),
    );
    categoryButtons[0]?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    search.input.value = "workshops";
    search.input.dispatchEvent(new Event("input"));
    document
      .querySelector('[data-filter-option-id="what:workshops-classes"]')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const output = {
      categories,
      thumbnails,
      selected: [
        ...document.querySelectorAll('[data-filter-token-id^="what:"]'),
      ].map((node) => node.textContent),
      resultTitle,
      selectedEvent: selection?.sourceEvents[selection.selectedEventIndex]?.id,
      whatDimensionCount: document.querySelectorAll(
        '[data-filter-dimension="what"]',
      ).length,
    };
    search.destroy();
    layer.destroy();
    return output;
  });
  expect(result).toEqual({
    categories: ["Performances", "Workshops & Classes"],
    thumbnails: [
      "/event-filter-thumbnails/performances.png",
      "/event-filter-thumbnails/workshops-classes.png",
    ],
    selected: ["Performances", "Workshops & Classes"],
    resultTitle: "Evening Jazz Concert",
    selectedEvent: "concert",
    whatDimensionCount: 0,
  });
});

test("event filter exposes a working custom date option and recognized prices", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    let filters = null;
    const search = createLandmarkEventSearch({
      onFilter: (nextFilters) => {
        filters = nextFilters;
        return { matchedEvents: 0, query: nextFilters.query, results: [] };
      },
    });
    const endBlankByDefault = search.filters.dateEnd.value;
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
    document.querySelector('[data-filter-dimension="price"]')?.click();
    const output = {
      dateLabel: search.filters.dateButton.textContent,
      dateLabelBeforeApply,
      endBlankByDefault,
      endBlankWhenAnyDateOpens,
      hasQuickScheduleFilters: Boolean(
        document.querySelector(".landmark-event-search__quick-dates"),
      ),
      priceOptions: [
        ...document.querySelectorAll(
          '[data-filter-option-id^="price:"] strong',
        ),
      ].map((node) => node.textContent),
      sameDayLabel,
      startOnlyLabel,
      filters,
    };
    search.destroy();
    return output;
  });
  expect(result).toEqual({
    dateLabel: "14 Jul – 21 Jul",
    dateLabelBeforeApply: "14 Jul – 21 Jul",
    endBlankByDefault: "",
    endBlankWhenAnyDateOpens: "",
    hasQuickScheduleFilters: false,
    priceOptions: ["Free", "Under $25", "$25–$50", "$50–$100", "Over $100"],
    sameDayLabel: "14 Jul",
    startOnlyLabel: "From 14 Jul",
    filters: {
      categories: [],
      query: "",
      dateRange: "custom",
      dateStart: "2026-07-14",
      dateEnd: "2026-07-21",
      placementView: "all",
      priceRange: "any",
      where: null,
    },
  });
});

test("event location views support keyboard, touch-sized controls, empty, and error states", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const item = {
      id: "secret",
      title: "Secret Supper",
      venue: "Location TBA",
      publicPlacement: "off_map",
      offMapSubtype: "secret_tba",
      scheduleKind: "anytime",
    };
    let shouldFail = false;
    const search = createLandmarkEventSearch({
      onFilter: ({ placementView }) => {
        if (shouldFail) throw new Error("fixture outage");
        const results = placementView === "secret_tba" ? [item] : [];
        return { matchedEvents: results.length, query: "", results };
      },
    });
    search.input.focus();
    document.querySelector('[data-filter-dimension="where"]').click();
    const secretTab = search.filters.placementViews.get("secret_tba");
    search.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    const keyboardFocused = document.activeElement?.classList.contains(
      "landmark-event-search__option",
    );
    const touchTargets = [
      ...document.querySelectorAll(".landmark-event-search__option"),
    ].every((node) => node.getBoundingClientRect().height >= 44);
    secretTab.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document
      .querySelector('[data-filter-token-id="where:mystery-location"]')
      .click();
    document.querySelector(".landmark-event-search__remove-phrase").click();
    const empty = {
      state: search.root.dataset.state,
      status: document.querySelector(".landmark-event-search__status")
        .textContent,
    };
    shouldFail = true;
    search.refresh();
    const error = {
      busy: search.root.getAttribute("aria-busy"),
      state: search.root.dataset.state,
      status: document.querySelector(".landmark-event-search__status")
        .textContent,
    };
    search.destroy();
    return { empty, error, keyboardFocused, touchTargets };
  });
  expect(state).toEqual({
    empty: { state: "empty", status: "No events available" },
    error: {
      busy: "false",
      state: "error",
      status: "Events are temporarily unavailable. Try again.",
    },
    keyboardFocused: true,
    touchTargets: true,
  });
});

test("search navigation can select an event without opening its detail callback", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    let openedDetails = false;
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: "panel",
      onSelect: () => {
        openedDetails = true;
      },
    });
    layer.add({
      landmark: {
        id: "arts-centre",
        label: "Arts Centre",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        {
          id: "concert",
          title: "Evening Jazz Concert",
          dateText: "14 Jul 2026",
        },
        { id: "talk", title: "Architecture Talk", dateText: "15 Jul 2026" },
      ],
    });
    const selected = layer.selectResult(
      { landmarkId: "arts-centre", eventIndex: 1 },
      { notify: false },
    );
    const highlighted = layer.setNavigationTarget("arts-centre");
    const pill = document.querySelector(".landmark-event-pill");
    const pillTitle = document.querySelector(
      ".landmark-event-pill__title",
    ).textContent;
    const navigationState = {
      current: pill
        .querySelector(".landmark-event-pill__card")
        .getAttribute("aria-current"),
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

test("event search supports exploration before the user knows what to type", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: {
        id: "arts-centre",
        label: "Arts Centre",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        {
          id: "concert",
          title: "Evening Jazz Concert",
          venue: "Concert Hall",
          dateText: "14 Jul 2026",
        },
        {
          id: "workshop",
          title: "Family Art Workshop",
          venue: "Gallery",
          dateText: "15 Jul 2026",
        },
      ],
    });
    const search = createLandmarkEventSearch({
      categories: ["Performances", "Workshops & Classes"],
      onFilter: (filters) => layer.setFilters(filters),
    });
    search.input.focus();
    const initial = {
      expanded: search.input.getAttribute("aria-expanded"),
      heading: document.querySelector(".landmark-event-search__results-title")
        ?.textContent,
      count: document.querySelector(".landmark-event-search__results-count")
        ?.textContent,
      results: [
        ...document.querySelectorAll(".landmark-event-search__result strong"),
      ].map((node) => node.textContent),
      popoverIsCompact:
        document
          .querySelector(".landmark-event-search__popover")
          .getBoundingClientRect().width <= 680,
    };
    document.querySelector('[data-filter-dimension="what"]').click();
    document
      .querySelector('[data-filter-option-id="what:workshops-classes"]')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const filtered = {
      heading: document.querySelector(".landmark-event-search__results-title")
        ?.textContent,
      results: [
        ...document.querySelectorAll(".landmark-event-search__result strong"),
      ].map((node) => node.textContent),
    };
    search.destroy();
    layer.destroy();
    return { filtered, initial, viewportWidth: window.innerWidth };
  });
  expect(result).toEqual({
    initial: {
      expanded: "true",
      heading: "Closest to this view",
      count: "2 found",
      results: ["Evening Jazz Concert", "Family Art Workshop"],
      popoverIsCompact: true,
    },
    filtered: {
      heading: "Workshops & Classes",
      results: ["Family Art Workshop"],
    },
    viewportWidth: result.viewportWidth,
  });
});

test("dismissed event search stays closed during refresh and reopens on user input", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const item = {
      id: "concert",
      title: "Evening Jazz Concert",
      venue: "Concert Hall",
    };
    const search = createLandmarkEventSearch({
      onFilter: ({ query }) => ({
        matchedEvents: 1,
        query: query.trim(),
        results: [item],
      }),
    });
    search.input.focus();
    document.querySelector(".landmark-event-search__result").click();
    search.refresh();
    const afterRefresh = search.input.getAttribute("aria-expanded");
    search.input.value = "jazz";
    search.input.dispatchEvent(new Event("input"));
    const afterInput = search.input.getAttribute("aria-expanded");
    window.dispatchEvent(
      new CustomEvent("whats-here:overlay-open", {
        detail: { id: "restaurants" },
      }),
    );
    const afterOtherOverlay = search.input.getAttribute("aria-expanded");
    search.destroy();
    return { afterInput, afterOtherOverlay, afterRefresh };
  });
  expect(state).toEqual({
    afterInput: "true",
    afterOtherOverlay: "false",
    afterRefresh: "false",
  });
});

test("event filter removes and explains stale options after a dataset replacement", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createEventDiscoveryModel } =
      await import("/activity-scenes/events/event-discovery-model.js");
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const firstModel = createEventDiscoveryModel([
      {
        id: "hall",
        label: "Hall",
        anchor: { lng: 103.85, lat: 1.29 },
        events: [
          {
            id: "show",
            title: "Evening Show",
            category: "Performances",
          },
        ],
      },
    ]);
    const search = createLandmarkEventSearch({ discoveryModel: firstModel });
    search.input.focus();
    document.querySelector('[data-filter-dimension="what"]').click();
    document
      .querySelector('[data-filter-option-id="what:performances"]')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    search.setDiscoveryModel(createEventDiscoveryModel([]));
    const result = {
      status: document.querySelector(".landmark-event-search__status")
        .textContent,
      tokenCount: document.querySelectorAll(
        '[data-filter-token-id="what:performances"]',
      ).length,
    };
    search.destroy();
    return result;
  });
  expect(state).toEqual({
    status: "Performances is no longer available.",
    tokenCount: 0,
  });
});

test("event results stay nearest-first and refresh after the map center changes", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    let center = { lng: 103.85, lat: 1.29 };
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getCenter: () => center,
      getZoom: () => 17,
      project: ([lng, lat]) => ({
        x: (lng - center.lng) * 10000 + 640,
        y: (center.lat - lat) * 10000 + 360,
      }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: {
        id: "far",
        label: "Far Venue",
        anchor: { lng: 103.9, lat: 1.29 },
      },
      sourceEvents: [{ title: "Far Event", dateText: "14 Jul 2026" }],
    });
    layer.add({
      landmark: {
        id: "near",
        label: "Near Venue",
        anchor: { lng: 103.851, lat: 1.29 },
      },
      sourceEvents: [{ title: "Near Event", dateText: "14 Jul 2026" }],
    });
    const search = createLandmarkEventSearch({
      onFilter: (filters) => layer.setFilters(filters),
    });
    const titles = () =>
      [
        ...document.querySelectorAll(".landmark-event-search__result strong"),
      ].map((node) => node.textContent);
    search.input.focus();
    const initial = titles();
    center = { lng: 103.9, lat: 1.29 };
    search.refresh();
    const afterMove = titles();
    search.destroy();
    layer.destroy();
    return { afterMove, initial };
  });
  expect(result).toEqual({
    afterMove: ["Far Event", "Near Event"],
    initial: ["Near Event", "Far Event"],
  });
});

test("event search lazily reveals every result while scrolling", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventSearch } =
      await import("/activity-scenes/landmark-event-search.js");
    const items = Array.from({ length: 18 }, (_, index) => ({
      category: "Exhibitions",
      date: `Day ${index + 1}`,
      inView: true,
      title: `Event ${index + 1}`,
      venue: "Gallery",
    }));
    const search = createLandmarkEventSearch({
      onFilter: () => ({
        matchedEvents: items.length,
        query: "",
        results: items,
      }),
    });
    search.input.focus();
    const panel = document.getElementById("landmark-event-search-results");
    const count = () =>
      panel.querySelectorAll(".landmark-event-search__result").length;
    const batches = [count()];
    panel.scrollTop = panel.scrollHeight;
    panel.dispatchEvent(new Event("scroll"));
    batches.push(count());
    panel.scrollTop = panel.scrollHeight;
    panel.dispatchEvent(new Event("scroll"));
    batches.push(count());
    const hintCount = panel.querySelectorAll(
      ".landmark-event-search__results-hint",
    ).length;
    search.destroy();
    return { batches, hintCount };
  });
  expect(result).toEqual({ batches: [8, 16, 18], hintCount: 0 });
});

test("selected location arrow becomes a pill highlight when its target enters the viewport", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkDirectionIndicator } =
      await import("/activity-scenes/landmark-direction-indicator.js");
    let projected = { x: 1600, y: 360 };
    let zoom = 12;
    const zoomMoves = [];
    let visibleLandmark = null;
    const map = {
      easeTo: (options) => {
        zoomMoves.push(options);
        zoom = options.zoom;
      },
      getZoom: () => zoom,
      project: () => projected,
    };
    const indicator = createLandmarkDirectionIndicator(map, {
      onVisible: (landmark) => {
        visibleLandmark = landmark.label;
      },
    });
    indicator.setTarget({ label: "Arts Centre", anchor: { lng: 1, lat: 1 } });
    const arrow = document.querySelector(".landmark-direction-indicator");
    const arrowIcon = arrow.querySelector(
      ".landmark-direction-indicator__arrow",
    );
    const offscreen = {
      hidden: arrow.hidden,
      icon: arrowIcon.className,
      label: arrow.getAttribute("aria-label"),
      rightMargin: Math.round(
        window.innerWidth - arrow.getBoundingClientRect().right,
      ),
    };
    indicator.setTarget({
      label: "VICTORIA THEATRE AND CONCERT HALL (U/C)",
      anchor: { lng: 1, lat: 1 },
    });
    const longLabel = arrow.querySelector(
      ".landmark-direction-indicator__label",
    );
    const fittedLongLabel = {
      fits:
        longLabel.scrollWidth <= longLabel.clientWidth &&
        longLabel.scrollHeight <= longLabel.clientHeight,
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

test("pill and direction positioning stay idle until the map changes", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkDirectionIndicator } =
      await import("/activity-scenes/landmark-direction-indicator.js");
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const listeners = new Map();
    const on = (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    };
    const off = (name, listener) => listeners.get(name)?.delete(listener);
    const emit = (name) =>
      listeners.get(name)?.forEach((listener) => listener());
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 15,
      on,
      off,
      project: ([lng]) =>
        lng === 2 ? { x: 1600, y: 300 } : { x: 200, y: 200 },
    };
    const pills = createLandmarkEventPillLayer({
      map,
      panelId: "panel",
      rotationMs: 10_000,
    });
    pills.add({
      landmark: {
        id: "idle-pill",
        label: "Idle pill",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        { id: "idle-event", title: "Idle event", dateText: "14 Jul 2026" },
      ],
    });
    const direction = createLandmarkDirectionIndicator(map);
    direction.setTarget({
      id: "idle-direction",
      label: "Idle direction",
      anchor: { lng: 2, lat: 1 },
    });
    const readCounts = () => ({
      direction: Number(
        document.body.dataset.landmarkDirectionUpdateCount || 0,
      ),
      clusterPasses: Number(
        document.body.dataset.landmarkEventClusterPositionPassCount || 0,
      ),
      pillPasses: Number(
        document.body.dataset.landmarkEventPillPositionPassCount || 0,
      ),
    });
    let previousCounts = readCounts();
    let stableTicks = 0;
    for (let attempt = 0; attempt < 20 && stableTicks < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const currentCounts = readCounts();
      stableTicks =
        currentCounts.direction === previousCounts.direction &&
        currentCounts.clusterPasses === previousCounts.clusterPasses &&
        currentCounts.pillPasses === previousCounts.pillPasses
          ? stableTicks + 1
          : 0;
      previousCounts = currentCounts;
    }
    const beforeIdle = readCounts();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterIdle = readCounts();
    emit("move");
    emit("move");
    emit("zoom");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const currentCounts = readCounts();
      if (
        currentCounts.direction > afterIdle.direction &&
        currentCounts.clusterPasses > afterIdle.clusterPasses &&
        currentCounts.pillPasses > afterIdle.pillPasses
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const afterMovement = readCounts();
    pills.destroy();
    direction.destroy();
    return {
      idleClusterPasses: afterIdle.clusterPasses - beforeIdle.clusterPasses,
      idleDirectionUpdates: afterIdle.direction - beforeIdle.direction,
      idlePillPasses: afterIdle.pillPasses - beforeIdle.pillPasses,
      movementClusterPasses:
        afterMovement.clusterPasses - afterIdle.clusterPasses,
      movementDirectionUpdates: afterMovement.direction - afterIdle.direction,
      movementPillPasses: afterMovement.pillPasses - afterIdle.pillPasses,
    };
  });
  expect(result).toEqual({
    idleClusterPasses: 0,
    idleDirectionUpdates: 0,
    idlePillPasses: 0,
    movementClusterPasses: 1,
    movementDirectionUpdates: 1,
    movementPillPasses: 1,
  });
});

test("hidden pills leave keyboard navigation", async ({ page }) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
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
    const layer = createLandmarkEventPillLayer({
      map,
      onHidden: () => {
        hiddenCalls += 1;
      },
      panelId: "panel",
    });
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
  expect(state).toEqual({
    ariaHidden: "true",
    focused: "map-focus",
    hiddenCalls: 1,
    tabIndex: -1,
  });
});

test("hidden pills cannot be selected with a pointer", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
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
      onSelect: () => {
        selections += 1;
      },
      panelId: "panel",
    });
    window.__hiddenPillSelections = () => selections;
    window.__hiddenPillLayer.add({
      landmark: {
        id: "hidden-pointer",
        label: "Hidden pointer",
        anchor: { lng: 1, lat: 1 },
      },
      sourceEvents: [
        { id: "event", title: "Hidden event", dateText: "12 Jul 2026" },
      ],
    });
  });

  const pill = page.locator("#hidden-pointer-event-pill");
  await expect(pill).toHaveAttribute("aria-hidden", "true");
  const cardBox = await pill
    .locator(".landmark-event-pill__card")
    .boundingBox();
  expect(cardBox).not.toBeNull();
  await page.mouse.click(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2,
  );
  await expect
    .poll(() => page.evaluate(() => window.__hiddenPillSelections()))
    .toBe(0);

  await page.evaluate(() => window.__hiddenPillLayer.destroy());
});

test("zoomed-out event locations reconcile into filtered cluster counts before pills", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    let zoom = 15;
    const listeners = new Map();
    const map = {
      easeTo: () => {},
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => zoom,
      on: (name, listener) => listeners.set(name, listener),
      off: (name) => listeners.delete(name),
      project: ([lng, lat]) => ({ x: lng, y: lat }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    for (const item of [
      {
        landmark: {
          id: "alpha-cluster",
          label: "Alpha Hall",
          anchor: { lng: 100, lat: 220 },
        },
        sourceEvents: [
          {
            id: "alpha-event",
            title: "Alpha Night",
            dateText: "12 Jul 2026",
          },
        ],
      },
      {
        landmark: {
          id: "bravo-cluster",
          label: "Bravo Hall",
          anchor: { lng: 145, lat: 220 },
        },
        sourceEvents: [
          {
            id: "bravo-event",
            title: "Bravo Night",
            dateText: "13 Jul 2026",
          },
        ],
      },
      {
        landmark: {
          id: "charlie-cluster",
          label: "Charlie Hall",
          anchor: { lng: 300, lat: 220 },
        },
        sourceEvents: [
          {
            id: "charlie-event",
            title: "Charlie Night",
            dateText: "14 Jul 2026",
          },
        ],
      },
    ]) {
      layer.add(item);
    }

    const snapshot = () => ({
      clusterAriaLabels: [
        ...document.querySelectorAll(".landmark-event-cluster__count"),
      ].map((element) => element.getAttribute("aria-label")),
      clusterCounts: [
        ...document.querySelectorAll(".landmark-event-cluster__count"),
      ]
        .map((element) => Number(element.textContent))
        .sort((left, right) => right - left),
      clusterMembers: [...document.querySelectorAll(".landmark-event-cluster")]
        .map((element) => element.dataset.clusterMembers)
        .sort(),
      pillVisibility: [
        ...document.querySelectorAll(".landmark-event-pill"),
      ].map((element) => element.getAttribute("aria-hidden")),
    });

    const overview = snapshot();
    layer.setSearchQuery("Alpha");
    const filtered = snapshot();
    layer.setSearchQuery("");
    layer.setNavigationTarget("alpha-cluster");
    const navigationTarget = snapshot();
    layer.setNavigationTarget(null);
    zoom = 17;
    listeners.get("zoom")?.();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const detail = snapshot();
    zoom = 15;
    listeners.get("zoom")?.();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const overviewAgain = snapshot();
    layer.setSearchQuery("No matching event");
    const empty = snapshot();
    layer.destroy();
    const destroyedClusterCount = document.querySelectorAll(
      ".landmark-event-cluster",
    ).length;

    return {
      destroyedClusterCount,
      detail,
      empty,
      filtered,
      navigationTarget,
      overview,
      overviewAgain,
    };
  });

  expect(state.overview.clusterCounts).toEqual([2, 1]);
  expect(state.overview.clusterMembers).toEqual([
    "alpha-cluster,bravo-cluster",
    "charlie-cluster",
  ]);
  expect(state.overview.clusterAriaLabels).toEqual(
    expect.arrayContaining([
      "Zoom in to explore 2 event locations",
      "Zoom in to explore Charlie Hall event location",
    ]),
  );
  expect(state.overview.pillVisibility).toEqual(["true", "true", "true"]);
  expect(state.filtered.clusterCounts).toEqual([1]);
  expect(state.filtered.clusterMembers).toEqual(["alpha-cluster"]);
  expect(state.navigationTarget.clusterCounts).toEqual([1, 1]);
  expect(state.navigationTarget.clusterMembers).not.toContain("alpha-cluster");
  expect(state.navigationTarget.pillVisibility).toEqual([
    "false",
    "true",
    "true",
  ]);
  expect(state.detail.clusterCounts).toEqual([]);
  expect(state.detail.pillVisibility).toEqual(["false", "false", "false"]);
  expect(state.overviewAgain.clusterCounts).toEqual([2, 1]);
  expect(state.empty.clusterCounts).toEqual([]);
  expect(state.empty.pillVisibility).toEqual(["true", "true", "true"]);
  expect(state.destroyedClusterCount).toBe(0);
});

test("event cluster counts navigate with pointer and keyboard activation", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    let zoom = 14;
    const easeCalls = [];
    const map = {
      easeTo: (options) => {
        easeCalls.push(options);
        zoom = options.zoom;
      },
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => zoom,
      on: () => {},
      off: () => {},
      project: ([lng, lat]) => ({ x: lng, y: lat }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: {
        id: "keyboard-cluster",
        label: "Keyboard Hall",
        anchor: { lng: 320, lat: 240 },
      },
      sourceEvents: [
        {
          id: "keyboard-event",
          title: "Keyboard Night",
          dateText: "12 Jul 2026",
        },
      ],
    });
    layer.add({
      landmark: {
        id: "pointer-cluster",
        label: "Pointer Hall",
        anchor: { lng: 360, lat: 240 },
      },
      sourceEvents: [
        {
          id: "pointer-event",
          title: "Pointer Night",
          dateText: "13 Jul 2026",
        },
      ],
    });
    window.__eventClusterTest = {
      easeCalls,
      layer,
      setZoom: (value) => {
        zoom = value;
      },
    };
  });

  const count = page.locator(".landmark-event-cluster__count");
  await expect(count).toHaveCount(1);
  await expect(count).toHaveAttribute(
    "aria-label",
    "Zoom in to explore 2 event locations",
  );
  await count.click();
  await count.press("Enter");
  await count.press("Space");
  await page.evaluate(() => {
    window.__eventClusterTest.setZoom(14);
    window.__eventClusterTest.layer.setSearchQuery("Keyboard");
  });
  await expect(count).toHaveAttribute(
    "aria-label",
    "Zoom in to explore Keyboard Hall event location",
  );
  await count.click();
  const calls = await page.evaluate(() => window.__eventClusterTest.easeCalls);
  expect(calls).toEqual([
    { center: [340, 240], duration: 700, zoom: 16 },
    { center: [340, 240], duration: 700, zoom: 16.65 },
    { center: [340, 240], duration: 700, zoom: 16.65 },
    { center: [320, 240], duration: 700, zoom: 16.65 },
  ]);

  await count.focus();
  await expect(count).toBeFocused();
  await page.evaluate(() => window.__eventClusterTest.layer.destroy());
  await expect(page.locator("#map-focus")).toBeFocused();
});

test("pill rotates events every three seconds without a progress indicator", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: "panel",
      rotationMs: 60,
    });
    layer.add({
      landmark: {
        id: "rotation",
        label: "Rotation",
        anchor: { lng: 1, lat: 1 },
      },
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
      hasExpandedList: Boolean(
        document.querySelector(".landmark-event-pill__expanded"),
      ),
      hasMeta: Boolean(document.querySelector(".landmark-event-pill__meta")),
      titleWhiteSpace: getComputedStyle(
        document.querySelector(".landmark-event-pill__title"),
      ).whiteSpace,
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

test("short pill titles center and shrink while preserving the existing maximum width", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    layer.add({
      landmark: { id: "compact", label: "Compact", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "event", title: "Common Room", dateText: "14 Jul 2026" },
      ],
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
  expect(result.maxWidth).toBe(
    (await page.viewportSize()).width <= 720 ? 200 : 220,
  );
});

test("singleton panel remains safe for existing consumers", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const first = createLandmarkEventPanel();
    const second = createLandmarkEventPanel();
    const trigger = document.getElementById("map-focus");
    first.open({
      landmark: { id: "test", label: "Test" },
      sourceEvents: [{ id: "event", title: "Event", dateText: "12 Jul 2026" }],
      trigger,
    });
    const result = {
      connected: document.getElementById(first.id)?.isConnected,
      same: first === second,
    };
    second.destroy();
    return result;
  });
  expect(state).toEqual({ connected: true, same: true });
});

test("event titles render as plain text in both pill and panel", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
    });
    const landmark = {
      id: "text-sanitize",
      label: "Text Sanitize",
      anchor: { lng: 1, lat: 1 },
    };
    layer.add({
      landmark,
      sourceEvents: [
        {
          id: "event-1",
          title: "<p>Fish &amp; Chips</p>",
          dateText: "12 Jul 2026",
          eventUrl: "https://example.com/fish",
        },
      ],
    });
    const pillTitle = document.querySelector(".landmark-event-pill__title");
    pillTitle.closest(".landmark-event-pill__card").click();
    const panelTitle = document.querySelector(
      ".landmark-event-panel__event-title",
    );
    const result = {
      eventNavigationHidden: document.querySelector(
        ".landmark-event-panel__events",
      ).hidden,
      pillText: pillTitle.textContent,
      pillHtml: pillTitle.innerHTML,
      panelText: panelTitle.textContent,
      panelHtml: panelTitle.innerHTML,
      viewEventVisible: !document.querySelector(".landmark-event-panel__link")
        .hidden,
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

test("successful snapshots refresh pills and the open panel while partial snapshots preserve them", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
      onEventsChanged: (change) => panel.refresh(change),
    });
    const alpha = { id: "alpha", label: "Alpha", anchor: { lng: 1, lat: 1 } };
    const beta = { id: "beta", label: "Beta", anchor: { lng: 2, lat: 2 } };
    layer.reconcile({
      runStatus: "success",
      landmarks: [
        {
          landmark: alpha,
          sourceEvents: [{ id: "a1", title: "Old title", dateText: "12 Jul" }],
        },
        {
          landmark: beta,
          sourceEvents: [{ id: "b1", title: "Beta event", dateText: "12 Jul" }],
        },
      ],
    });
    document
      .querySelector("#alpha-event-pill .landmark-event-pill__card")
      .click();
    const partialAccepted = layer.reconcile({
      runStatus: "partial",
      landmarks: [
        {
          landmark: alpha,
          sourceEvents: [
            { id: "a2", title: "Partial title", dateText: "13 Jul" },
          ],
        },
      ],
    });
    const afterPartial = document.querySelector(
      ".landmark-event-panel__event-title",
    ).textContent;
    layer.reconcile({
      runStatus: "success",
      landmarks: [
        {
          landmark: alpha,
          sourceEvents: [
            { id: "a1", title: "Updated title", dateText: "12 Jul" },
            { id: "a2", title: "New event", dateText: "13 Jul" },
          ],
        },
      ],
    });
    const afterSuccess = document.querySelector(
      ".landmark-event-panel__event-title",
    ).textContent;
    const eventCount = Number(
      document
        .querySelector(".landmark-event-panel__event-position")
        .textContent.match(/of (\d+)/)?.[1],
    );
    const betaRemoved = !document.getElementById("beta-event-pill");
    const alphaCount = document.querySelectorAll("#alpha-event-pill").length;
    layer.reconcile({ runStatus: "success", landmarks: [] });
    const closedAfterRemoval = document.getElementById(panel.id).hidden;
    layer.destroy();
    panel.destroy();
    return {
      afterPartial,
      afterSuccess,
      alphaCount,
      betaRemoved,
      closedAfterRemoval,
      eventCount,
      partialAccepted,
    };
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

test("panel sorts canonically, isolates gestures, and rejects invalid details", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    trigger.setAttribute("aria-expanded", "false");
    const panel = createLandmarkEventPanel();
    panel.open({
      landmark: { id: "test", label: "Verified Landmark" },
      sourceEvents: [
        {
          id: "late",
          title: "Late",
          startDateTime: "2026-07-13T19:00:00+08:00",
          dateText: "13 Jul 2026",
          venueVerified: true,
        },
        { id: "missing-title", startDateTime: "2026-07-11T19:00:00+08:00" },
        {
          id: "early",
          title: "Early",
          startDateTime: "2026-07-12T19:00:00+08:00",
          dateText: "12 Jul 2026",
          eventUrl: "javascript:bad",
        },
      ],
      selectedEventIndex: 0,
      trigger,
    });
    const selected = document.querySelector(
      ".landmark-event-panel__event-title",
    )?.textContent;
    const position = document.querySelector(
      ".landmark-event-panel__event-position",
    )?.textContent;
    const venue = document.querySelector(
      ".landmark-event-panel__field--venue dd",
    )?.textContent;
    let bubbledWheels = 0;
    document.addEventListener(
      "wheel",
      () => {
        bubbledWheels += 1;
      },
      { once: true },
    );
    document
      .getElementById(panel.id)
      .dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const unavailableLink = document.querySelector(
      ".landmark-event-panel__link",
    );
    const iconClasses = [
      ...document.querySelectorAll(".landmark-event-panel__actions .ph-bold"),
    ].map((icon) => icon.className);
    const eventNav = [
      ...document.querySelectorAll(".landmark-event-panel__event-nav"),
    ].map((button) => ({
      icon: button.querySelector(".ph-bold")?.className,
      label: button.getAttribute("aria-label"),
    }));
    panel.destroy();
    return {
      bubbledWheels,
      eventNav,
      iconClasses,
      position,
      selected,
      unavailableLink: unavailableLink?.hidden === false,
      venue,
    };
  });
  expect(result).toEqual({
    bubbledWheels: 0,
    eventNav: [
      { icon: "ph-bold ph-arrow-left", label: "Previous event" },
      { icon: "ph-bold ph-arrow-right", label: "Next event" },
    ],
    iconClasses: [
      "ph-bold ph-list-plus",
      "ph-bold ph-arrow-square-out",
      "ph-bold ph-navigation-arrow",
      "ph-bold ph-x",
    ],
    position: "2 of 2 activities",
    selected: "Late",
    unavailableLink: false,
    venue: "Verified Landmark",
  });
});

test("event panel renders the complete display contract and only exposes validated official links", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    const panel = createLandmarkEventPanel();
    panel.open({
      landmark: {
        id: "venue",
        label: "Verified Venue",
        anchor: { lat: 1.29, lng: 103.85 },
      },
      sourceEvents: [
        {
          id: "one",
          title: "Complete details",
          dateText: "14 Jul 2026",
          eventUrl: "https://example.com/official",
          sources: [
            { source: "Catch.sg", sourceUrl: "https://example.com/official" },
          ],
        },
      ],
      trigger,
    });
    const fieldsWithLink = Object.fromEntries(
      [...document.querySelectorAll(".landmark-event-panel__field")].map(
        (row) => [
          row.querySelector("dt").textContent,
          row.querySelector("dd").textContent,
        ],
      ),
    );
    const descriptionWithLink = document.querySelector(
      ".landmark-event-panel__description-copy",
    ).textContent;
    const link = document.querySelector(".landmark-event-panel__link");
    const officialLink = { hidden: link.hidden, href: link.href };
    const directions = document.querySelector(
      ".landmark-event-panel__directions",
    );
    const directionsLink = { hidden: directions.hidden, href: directions.href };
    const header = {
      backLabel: document
        .querySelector(".landmark-event-panel__back")
        ?.getAttribute("aria-label"),
      hasUpcomingEventsKicker: Boolean(
        document.querySelector(".landmark-event-panel__kicker"),
      ),
      placeName: document.querySelector(".landmark-event-panel__heading")
        ?.textContent,
    };
    const detailStyle = getComputedStyle(
      document.querySelector(".landmark-event-panel__details"),
    );
    const eventContentPadding = {
      left: detailStyle.paddingLeft,
      top: detailStyle.paddingTop,
    };
    panel.open({
      landmark: { id: "venue", label: "Verified Venue" },
      sourceEvents: [
        {
          id: "two",
          title: "No official link",
          eventUrl: "javascript:alert(1)",
        },
      ],
      trigger,
    });
    const invalidLinkHidden = link.hidden;
    const directionsHiddenWithoutCoordinates = directions.hidden;
    const singletonCount = document.querySelectorAll(
      "#landmark-event-panel",
    ).length;
    const actionLabels = [
      ...document.querySelectorAll(
        ".landmark-event-panel__actions [aria-label]",
      ),
    ].map((element) => element.getAttribute("aria-label"));
    document.querySelector(".landmark-event-panel__back").click();
    const backClosedPanel = document.getElementById(panel.id).hidden;
    const backRestoredFocus = document.activeElement === trigger;
    panel.destroy();
    return {
      actionLabels,
      backClosedPanel,
      backRestoredFocus,
      descriptionWithLink,
      directionsHiddenWithoutCoordinates,
      directionsLink,
      eventContentPadding,
      fieldsWithLink,
      header,
      invalidLinkHidden,
      officialLink,
      singletonCount,
    };
  });
  expect(result).toEqual({
    actionLabels: [
      "Add event to plan",
      "View event website",
      "Get directions to venue",
      "Close event details",
    ],
    backClosedPanel: true,
    backRestoredFocus: true,
    descriptionWithLink: "Not available",
    directionsHiddenWithoutCoordinates: true,
    directionsLink: {
      hidden: false,
      href: "https://www.google.com/maps/dir/?api=1&destination=1.29%2C103.85",
    },
    eventContentPadding:
      (await page.viewportSize()).width <= 720
        ? { left: "18px", top: "18px" }
        : { left: "28px", top: "28px" },
    fieldsWithLink: {
      "Sources & tickets": "Catch.sg",
      Date: "14 Jul 2026",
      Time: "Not available",
      "Location type": "Single location",
      Venue: "Not available",
      Address: "Not available",
      Category: "Not available",
      Price: "Not available",
      Organizer: "Not available",
    },
    header: {
      backLabel: "Back to events",
      hasUpcomingEventsKicker: false,
      placeName: "Verified Venue",
    },
    invalidLinkHidden: true,
    officialLink: { hidden: false, href: "https://example.com/official" },
    singletonCount: 1,
  });
});

test("event panel exposes canonical source offers and complete sessions from map and search entry points", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    const landmark = {
      id: "marina-square",
      label: "MARINA SQUARE",
      anchor: { lat: 1.2915, lng: 103.8577 },
    };
    const activity = {
      schemaVersion: "1.0",
      activityId: "activity:funvee",
      title: "FunVee Singapore: Day Tour by Open-Top Bus",
      description: "Open-top sightseeing tour.",
      category: "Tours & Experiences",
      organizer: null,
      price: "SGD 22",
      sessions: [
        {
          sessionId: "session:morning",
          schedule: {
            kind: "exact",
            start: "2026-07-26T00:00:00+08:00",
            end: "2026-07-26T02:00:00+08:00",
            displayText: "2026-07-26",
          },
          availability: "available",
          venueGroupIds: ["venue-group:marina"],
        },
        {
          sessionId: "session:evening",
          schedule: {
            kind: "exact",
            start: "2026-07-27T18:30:00+08:00",
            end: "2026-07-27T20:30:00+08:00",
            displayText: "2026-07-27",
          },
          availability: "available",
          venueGroupIds: ["venue-group:promenade"],
        },
      ],
      venueGroups: [
        {
          venueGroupId: "venue-group:marina",
          activityId: "activity:funvee",
          label: "MARINA SQUARE",
          address: "6 Raffles Boulevard",
          publicPlacement: "mapped",
          mappingStatus: "approved",
          approvedLocationId: "marina-square",
          coordinates: { lat: 1.2915, lng: 103.8577 },
          sessionIds: ["session:morning"],
        },
        {
          venueGroupId: "venue-group:promenade",
          activityId: "activity:funvee",
          label: "PROMENADE",
          address: "Temasek Avenue",
          publicPlacement: "mapped",
          mappingStatus: "approved",
          approvedLocationId: "promenade",
          coordinates: { lat: 1.293, lng: 103.861 },
          sessionIds: ["session:evening"],
        },
      ],
      sourceOffers: [
        {
          offerId: "offer:fever",
          source: "Fever Singapore",
          url: "https://feverup.com/m/137694",
          scope: "activity",
          sessionIds: [],
        },
        {
          offerId: "offer:evening",
          source: "Evening tickets",
          url: "https://tickets.example/evening",
          scope: "sessions",
          sessionIds: ["session:evening"],
        },
      ],
      scheduleSummary: {
        kind: "multiple",
        label: "2 sessions",
        sessionCount: 2,
      },
    };
    const readFields = () =>
      Object.fromEntries(
        [...document.querySelectorAll(".landmark-event-panel__field")].map(
          (row) => [
            row.querySelector("dt").textContent,
            row.querySelector("dd").textContent,
          ],
        ),
      );
    const readLinks = () =>
      [
        ...document.querySelectorAll(".landmark-event-panel__reference-link"),
      ].map((link) => ({ label: link.textContent, href: link.href }));

    let panel = createLandmarkEventPanel();
    panel.open({ landmark, sourceEvents: [activity], trigger });
    const mapInitial = {
      state: panel.snapshot(),
      fields: readFields(),
      links: readLinks(),
      standaloneSchedulePresent: Boolean(
        document.querySelector(".landmark-event-panel__schedule"),
      ),
      dateChoiceRowPresent: Boolean(
        document.querySelector(".landmark-event-panel__field--date-choices"),
      ),
      timeChoiceRowPresent: Boolean(
        document.querySelector(".landmark-event-panel__field--time-choices"),
      ),
      dateChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--date"),
      ].map((button) => button.textContent),
      timeChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--time"),
      ].map((button) => button.textContent),
    };
    document
      .querySelectorAll(".landmark-event-panel__session--date")[1]
      .click();
    const mapEvening = {
      state: panel.snapshot(),
      fields: readFields(),
      links: readLinks(),
      selectedDates: [
        ...document.querySelectorAll(".landmark-event-panel__session--date"),
      ].map((button) => ({
        label: button.textContent,
        selected: button.getAttribute("aria-pressed"),
      })),
      timeChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--time"),
      ].map((button) => button.textContent),
    };
    panel.destroy();

    panel = createLandmarkEventPanel();
    panel.open({
      landmark,
      sourceEvents: [activity],
      activity: {
        ...activity,
        matchingOccurrences: [{ occurrenceId: "session:morning" }],
      },
      trigger,
    });
    const searchInitial = {
      state: panel.snapshot(),
      fields: readFields(),
      links: readLinks(),
      standaloneSchedulePresent: Boolean(
        document.querySelector(".landmark-event-panel__schedule"),
      ),
      dateChoiceRowPresent: Boolean(
        document.querySelector(".landmark-event-panel__field--date-choices"),
      ),
      timeChoiceRowPresent: Boolean(
        document.querySelector(".landmark-event-panel__field--time-choices"),
      ),
      dateChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--date"),
      ].map((button) => button.textContent),
      timeChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--time"),
      ].map((button) => button.textContent),
    };
    panel.destroy();

    return { mapInitial, mapEvening, searchInitial };
  });

  expect(result.mapInitial.state.occurrenceIds).toEqual([
    "session:morning",
    "session:evening",
  ]);
  expect(result.mapInitial.standaloneSchedulePresent).toBe(false);
  expect(result.mapInitial.dateChoiceRowPresent).toBe(true);
  expect(result.mapInitial.timeChoiceRowPresent).toBe(true);
  expect(result.mapInitial.dateChoices).toEqual(["2026-07-26", "2026-07-27"]);
  expect(result.mapInitial.timeChoices).toEqual(["12:00 AM"]);
  expect(result.mapInitial.fields.Date).toBe("2026-07-262026-07-27");
  expect(result.mapInitial.fields.Time).toBe("12:00 AM");
  expect(result.mapInitial.state.referenceIds).toEqual(["offer:fever"]);
  expect(result.mapInitial.links).toEqual([
    {
      label: "Fever Singapore",
      href: "https://feverup.com/m/137694",
    },
  ]);
  expect(result.mapInitial.fields).toMatchObject({
    "Sources & tickets": "Fever Singapore",
    Category: "Tours & Experiences",
    Price: "SGD 22",
    Organizer: "Not available",
  });
  expect(result.mapEvening.state.selectedOccurrenceId).toBe("session:evening");
  expect(result.mapEvening.selectedDates).toEqual([
    { label: "2026-07-26", selected: "false" },
    { label: "2026-07-27", selected: "true" },
  ]);
  expect(result.mapEvening.timeChoices).toEqual(["6:30 PM"]);
  expect(result.mapEvening.state.referenceIds).toEqual([
    "offer:fever",
    "offer:evening",
  ]);
  expect(result.mapEvening.links).toEqual([
    {
      label: "Fever Singapore",
      href: "https://feverup.com/m/137694",
    },
    {
      label: "Evening tickets",
      href: "https://tickets.example/evening",
    },
  ]);
  expect(result.mapEvening.fields).toMatchObject({
    "Sources & tickets": "Fever Singapore · Evening tickets",
  });
  expect(result.searchInitial).toEqual(result.mapInitial);
});

test("single-session schedule is omitted while same-date multiple timings remain selectable", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    const landmark = {
      id: "sculpture-square",
      label: "SCULPTURE SQUARE",
      anchor: { lat: 1.301, lng: 103.852 },
    };
    const makeActivity = (activityId, starts) => ({
      schemaVersion: "1.0",
      activityId,
      title: "Schedule presentation fixture",
      description: null,
      category: null,
      organizer: null,
      price: null,
      sessions: starts.map((start, index) => ({
        sessionId: `session:${activityId}:${index + 1}`,
        schedule: {
          kind: "exact",
          start,
          end: start,
          displayText: "2026-07-31",
        },
        availability: "unknown",
        venueGroupIds: ["venue-group:sculpture"],
      })),
      venueGroups: [
        {
          venueGroupId: "venue-group:sculpture",
          activityId,
          label: "SCULPTURE SQUARE",
          address: "155 Middle Road",
          publicPlacement: "mapped",
          mappingStatus: "approved",
          approvedLocationId: "sculpture-square",
          coordinates: { lat: 1.301, lng: 103.852 },
          sessionIds: starts.map(
            (_, index) => `session:${activityId}:${index + 1}`,
          ),
        },
      ],
      sourceOffers: [],
      scheduleSummary: {
        kind: starts.length === 1 ? "exact" : "multiple",
        label: starts.length === 1 ? "2026-07-31" : "2 sessions",
        sessionCount: starts.length,
      },
    });
    const readFields = () =>
      Object.fromEntries(
        [...document.querySelectorAll(".landmark-event-panel__field")].map(
          (row) => [
            row.querySelector("dt").textContent,
            row.querySelector("dd").textContent,
          ],
        ),
      );
    const readSchedule = () => ({
      standalonePresent: Boolean(
        document.querySelector(".landmark-event-panel__schedule"),
      ),
      dateChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--date"),
      ].map((button) => button.textContent),
      timeChoices: [
        ...document.querySelectorAll(".landmark-event-panel__session--time"),
      ].map((button) => button.textContent),
    });

    let panel = createLandmarkEventPanel();
    const singleton = makeActivity("activity:singleton", [
      "2026-07-31T00:00:00+08:00",
    ]);
    panel.open({ landmark, sourceEvents: [singleton], trigger });
    const single = {
      schedule: readSchedule(),
      fields: readFields(),
      selectionAccepted: panel.selectOccurrence(
        "activity:singleton",
        "session:activity:singleton:1",
      ),
    };
    panel.destroy();

    panel = createLandmarkEventPanel();
    const multiple = makeActivity("activity:multiple", [
      "2026-07-31T10:00:00+08:00",
      "2026-07-31T14:00:00+08:00",
    ]);
    panel.open({ landmark, sourceEvents: [multiple], trigger });
    const multipleBefore = readSchedule();
    const selectionAccepted = panel.selectOccurrence(
      "activity:multiple",
      "session:activity:multiple:2",
    );
    const multipleAfter = {
      selectedOccurrenceId: panel.snapshot().selectedOccurrenceId,
      fields: readFields(),
    };
    panel.destroy();

    panel = createLandmarkEventPanel();
    panel.open({
      landmark,
      sourceEvents: [
        {
          id: "flexible-1",
          parentActivityId: "activity:flexible",
          title: "Flexible schedule",
          dateText: "By appointment",
          venue: "SCULPTURE SQUARE",
        },
        {
          id: "flexible-2",
          parentActivityId: "activity:flexible",
          title: "Flexible schedule",
          dateText: "Selected weekends",
          venue: "SCULPTURE SQUARE",
        },
      ],
      trigger,
    });
    const flexible = {
      dateChoices: document.querySelectorAll(
        ".landmark-event-panel__session--date",
      ).length,
      timeChoices: document.querySelectorAll(
        ".landmark-event-panel__session--time",
      ).length,
      scheduleChoices: [
        ...document.querySelectorAll(
          ".landmark-event-panel__session--schedule",
        ),
      ].map((button) => button.textContent),
    };
    panel.destroy();

    return {
      single,
      multipleBefore,
      selectionAccepted,
      multipleAfter,
      flexible,
    };
  });

  expect(result.single).toEqual({
    schedule: {
      standalonePresent: false,
      dateChoices: [],
      timeChoices: [],
    },
    fields: expect.objectContaining({
      Date: "2026-07-31",
      Time: "12:00 AM",
      Venue: "SCULPTURE SQUARE",
      Address: "155 Middle Road",
    }),
    selectionAccepted: false,
  });
  expect(result.multipleBefore).toEqual({
    standalonePresent: false,
    dateChoices: ["2026-07-31"],
    timeChoices: ["10:00 AM", "2:00 PM"],
  });
  expect(result.selectionAccepted).toBe(true);
  expect(result.multipleAfter.selectedOccurrenceId).toBe(
    "session:activity:multiple:2",
  );
  expect(result.multipleAfter.fields.Date).toBe("2026-07-31");
  expect(result.multipleAfter.fields.Time).toBe("10:00 AM2:00 PM");
  expect(result.multipleAfter.fields.Venue).toBe("SCULPTURE SQUARE");
  expect(result.flexible).toEqual({
    dateChoices: 0,
    timeChoices: 0,
    scheduleChoices: ["By appointment", "Selected weekends"],
  });
});

test("event panel combines sibling occurrences and keeps exact session planning identity", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const trigger = document.getElementById("map-focus");
    const panel = createLandmarkEventPanel();
    let planned = null;
    window.addEventListener(
      "whats-here:add-to-plan",
      (event) => (planned = event.detail),
      { once: true },
    );
    panel.open({
      landmark: {
        id: "victoria",
        label: "Victoria Theatre",
        anchor: { lat: 1.288, lng: 103.851 },
      },
      sourceEvents: [
        {
          id: "show-1",
          occurrenceId: "show-1",
          parentActivityId: "activity:show",
          title: "Example Show",
          venue: "Victoria Theatre",
          dateText: "1 Aug 2026",
          startDateTime: "2026-08-01T20:00:00+08:00",
          eventUrl: "https://example.com/show/1",
        },
        {
          id: "show-2",
          occurrenceId: "show-2",
          parentActivityId: "activity:show",
          title: "Example Show",
          venue: "Victoria Theatre",
          dateText: "2 Aug 2026",
          startDateTime: "2026-08-02T20:00:00+08:00",
          eventUrl: "https://example.com/show/2",
        },
      ],
      trigger,
    });
    const sessions = [
      ...document.querySelectorAll(".landmark-event-panel__session--date"),
    ];
    sessions[1].click();
    panel.addToPlan();
    const state = {
      activityNavigationHidden: document.querySelector(
        ".landmark-event-panel__events",
      ).hidden,
      sessionCount: sessions.length,
      selected: [
        ...document.querySelectorAll(".landmark-event-panel__session--date"),
      ].map((item) => item.getAttribute("aria-pressed")),
      plannedId: planned?.id,
      reference: document.querySelector(".landmark-event-panel__link").href,
    };
    panel.destroy();
    return state;
  });
  expect(result).toEqual({
    activityNavigationHidden: true,
    sessionCount: 2,
    selected: ["false", "true"],
    plannedId: "show-2",
    reference: "https://example.com/show/2",
  });
});

test("event panel reveals large session lists without hiding exact identities", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    panel.open({
      landmark: { id: "hall", label: "Hall", anchor: { lat: 1.3, lng: 103.8 } },
      sourceEvents: Array.from({ length: 9 }, (_, index) => ({
        id: `show-${index + 1}`,
        occurrenceId: `show-${index + 1}`,
        parentActivityId: "activity:long-show",
        title: "Long-running Show",
        venue: "Hall",
        dateText: `${index + 1} Aug 2026`,
        startDateTime: `2026-08-${String(index + 1).padStart(2, "0")}T20:00:00+08:00`,
      })),
      trigger: document.getElementById("map-focus"),
    });
    const before = document.querySelectorAll(
      ".landmark-event-panel__session--date",
    ).length;
    const reveal = document.querySelector(
      ".landmark-event-panel__session-reveal",
    );
    const collapsedLabel = reveal.textContent;
    const comparableStyle = (element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        minHeight: style.minHeight,
        padding: style.padding,
      };
    };
    const styleMatchesUnselectedDateChoice =
      JSON.stringify(comparableStyle(reveal)) ===
      JSON.stringify(
        comparableStyle(
          document.querySelectorAll(".landmark-event-panel__session--date")[1],
        ),
      );
    reveal.click();
    const expanded = document.querySelectorAll(
      ".landmark-event-panel__session--date",
    ).length;
    const expandedState = document
      .querySelector(".landmark-event-panel__session-reveal")
      .getAttribute("aria-expanded");
    panel.destroy();
    return {
      before,
      collapsedLabel,
      expanded,
      expandedState,
      styleMatchesUnselectedDateChoice,
    };
  });
  expect(result).toEqual({
    before: 6,
    collapsedLabel: "+3 dates",
    expanded: 9,
    expandedState: "true",
    styleMatchesUnselectedDateChoice: true,
  });
});

test("shared pill edge clamp and panel remain usable on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/test-harness.html");
  const bounds = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const { createLandmarkEventPanel } =
      await import("/activity-scenes/landmark-event-panel.js");
    const panel = createLandmarkEventPanel();
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 5, y: 300 }),
    };
    const layer = createLandmarkEventPillLayer({
      map,
      panelId: panel.id,
      onSelect: (selection) => panel.open(selection),
    });
    layer.add({
      landmark: { id: "edge", label: "Edge", anchor: { lng: 1, lat: 1 } },
      sourceEvents: [
        { id: "edge-event", title: "Edge event", dateText: "12 Jul 2026" },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector(".landmark-event-pill__card").click();
    const card = document
      .querySelector(".landmark-event-pill__card")
      .getBoundingClientRect();
    const panelRect = document.getElementById(panel.id).getBoundingClientRect();
    const result = {
      cardLeft: card.left,
      cardRight: card.right,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
    };
    layer.destroy();
    panel.destroy();
    return result;
  });
  expect(bounds.cardLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.cardRight).toBeLessThanOrEqual(390);
  expect(bounds.panelLeft).toBeGreaterThanOrEqual(0);
  expect(bounds.panelRight).toBeLessThanOrEqual(390);
});

test("pills retain selectable and unverified activities when no literal date text is available", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const result = await page.evaluate(async () => {
    const { createLandmarkEventPillLayer } =
      await import("/activity-scenes/landmark-event-pill.js");
    const map = {
      getCanvas: () => document.getElementById("map-focus"),
      getZoom: () => 17,
      project: () => ({ x: 200, y: 200 }),
    };
    const layer = createLandmarkEventPillLayer({ map, panelId: "panel" });
    const selectable = layer.add({
      landmark: {
        id: "selectable",
        label: "Selectable",
        anchor: { lng: 103.85, lat: 1.29 },
      },
      sourceEvents: [
        {
          id: "selectable-event",
          title: "Choose a session",
          schedule: { kind: "selectable", displayText: null },
        },
      ],
    });
    const unverified = layer.add({
      landmark: {
        id: "unverified",
        label: "Unverified",
        anchor: { lng: 103.86, lat: 1.3 },
      },
      sourceEvents: [
        {
          id: "unverified-event",
          title: "Schedule pending",
          schedule: { kind: "unverified", displayText: null },
        },
      ],
    });
    const labels = [
      ...document.querySelectorAll(".landmark-event-pill__title"),
    ].map((node) => node.textContent);
    layer.destroy();
    return {
      labels,
      selectable: Boolean(selectable),
      unverified: Boolean(unverified),
    };
  });
  expect(result).toEqual({
    labels: ["Choose a session", "Schedule pending"],
    selectable: true,
    unverified: true,
  });
});
