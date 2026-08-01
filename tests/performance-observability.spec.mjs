import { expect, test } from "playwright/test";

const ordinaryUrl =
  "/?emptyApprovedSnapshot&rawTiles#8/1.285844/103.857897/-30/60";
const diagnosticsUrl =
  "/?emptyApprovedSnapshot&rawTiles&performanceDiagnostics=1#8/1.285844/103.857897/-30/60";

test("ordinary sessions do not activate diagnostics", async ({ page }) => {
  await page.goto(ordinaryUrl);
  await expect(page.locator(".performance-diagnostics")).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      diagnostics: Boolean(globalThis.__performanceDiagnostics),
      state: document.body.dataset.performanceDiagnostics ?? null,
    })),
  ).toEqual({ diagnostics: false, state: null });
});

test("opt-in diagnostics show aggregate signals and clean up with the map", async ({
  page,
}) => {
  await page.goto(diagnosticsUrl);
  const panel = page.locator(".performance-diagnostics");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Performance");
  await expect(panel).toContainText("network.totalBytes");
  await expect(panel).toContainText("memory.usedJsHeapBytes");
  expect(await panel.locator("li[data-state]").count()).toBeGreaterThanOrEqual(
    18,
  );
  await expect(panel).toContainText("startup.mapInitializedMs");
  await expect(panel).toContainText("Largest resources");
  await panel.getByText("Largest resources").click();
  await expect(panel).toContainText("First resource");

  const beforeMotion = await page.evaluate(() =>
    globalThis.__performanceDiagnostics.debugState(),
  );
  expect(beforeMotion.active).toBe(true);
  expect(beforeMotion.observers).toBeGreaterThan(0);
  expect(beforeMotion.timer).toBe(true);

  await expect
    .poll(() => page.locator("body").getAttribute("data-map-initialized"))
    .toBe("true");
  await page.evaluate(() => {
    window._map.fire("movestart");
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.__performanceDiagnostics.debugState().motionFrame,
      ),
    )
    .toBe(true);
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    window._map.fire("moveend");
  });
  await expect(panel).toContainText("motion.averageFps");

  const serialized = await page.evaluate(() =>
    JSON.stringify(globalThis.__performanceDiagnostics.snapshot()),
  );
  expect(Buffer.byteLength(serialized)).toBeLessThan(100 * 1024);
  for (const prohibited of [
    "snapshotId",
    "selectedDiscoveryArea",
    "longitude",
    "latitude",
    "conversation",
  ])
    expect(serialized).not.toContain(prohibited);

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export snapshot" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^amble-performance-\d+\.json$/);

  await page.evaluate(() => window._map.remove());
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(() => Boolean(globalThis.__performanceDiagnostics)),
  ).toBe(false);
});

test("diagnostics distinguish reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(diagnosticsUrl);
  await expect(page.locator(".performance-diagnostics__status")).toContainText(
    "reduced motion",
  );
});
