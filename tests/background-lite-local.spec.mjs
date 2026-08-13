import { expect, test } from "playwright/test";

const cameras = [
  { category: "landmark-glass", hash: "#17.2/1.2863/103.8593/18/58" },
  { category: "civic", hash: "#17.1/1.2903/103.8515/0/60" },
  { category: "heritage", hash: "#17.3/1.2826/103.8444/-12/55" },
  { category: "residential", hash: "#16.9/1.3146/103.7652/24/52" },
  { category: "industrial", hash: "#16.7/1.3271/103.6784/-20/48" },
];

test("local validation uses five genuinely distinct requested and observed cameras", async ({
  page,
}) => {
  await page.setContent(`<main id="map"></main>`);
  const observed = [];
  for (const camera of cameras) {
    const result = await page.evaluate(({ category, hash }) => {
      location.hash = hash;
      return { category, observedHash: location.hash };
    }, camera);
    observed.push(result);
  }
  expect(new Set(cameras.map(({ category }) => category)).size).toBe(5);
  expect(new Set(cameras.map(({ hash }) => hash)).size).toBe(5);
  expect(new Set(observed.map(({ observedHash }) => observedHash)).size).toBe(
    5,
  );
  expect(observed.map(({ observedHash }) => observedHash)).toEqual(
    cameras.map(({ hash }) => hash),
  );
});

test("each local before/after scene requires matched renderable counts and both layers", async ({
  page,
}) => {
  await page.setContent(`<main id="map"></main>`);
  const results = await page.evaluate(
    (definitions) =>
      definitions.map((camera, index) => {
        const before = {
          backgroundRenderable: 8 + index,
          backgroundSelected: 8 + index,
          overlayRenderable: 1,
          overlaySelected: 1,
        };
        const after = structuredClone(before);
        return {
          ...camera,
          after,
          before,
          matched:
            before.backgroundRenderable === after.backgroundRenderable &&
            before.backgroundSelected === after.backgroundSelected &&
            before.overlayRenderable === after.overlayRenderable &&
            before.overlaySelected === after.overlaySelected &&
            after.backgroundRenderable > 0 &&
            after.overlayRenderable > 0,
        };
      }),
    cameras,
  );
  expect(results).toHaveLength(5);
  expect(results.every(({ matched }) => matched)).toBe(true);
});

test("normal local startup loads assets when supported and preserves the mobile gate", async (
  { page },
  testInfo,
) => {
  await page.route("**/__local-building-assets/manifest.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        schemaVersion: "local-building-assets-v1",
        state: "active-local",
        manifestId: "browser-fixture",
        background: {
          complete: true,
          manifestId: "background-fixture",
          opacity: 0.3,
          url: "/optimized-tiles/tileset.json",
        },
        overlays: {
          complete: true,
          catalogueId: "overlay-fixture",
          opacity: 1,
          url: "/poi-tiles/event-venues/tileset.json",
        },
      },
    }),
  );
  await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
  if (testInfo.project.name.endsWith("-mobile")) {
    await expect(page.locator("body")).toHaveAttribute(
      "data-device-support",
      "unsupported",
    );
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-local-building-asset-state",
      "active-local",
    );
    return;
  }
  await expect(page.locator("body")).toHaveAttribute(
    "data-local-building-asset-state",
    "active-local",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-building-asset-manifest-id",
    "browser-fixture",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-background-tileset-url",
    "/optimized-tiles/tileset.json",
  );
});
