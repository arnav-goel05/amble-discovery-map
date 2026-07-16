import { expect, test } from "playwright/test";

async function mount(page) {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createSnapshotStatus } = await import("/activity-scenes/snapshot-status.js");
    window.__snapshotStatus = createSnapshotStatus();
  });
}

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 760 }]]) {
  test(`${name} shows one restrained global stale indicator and an explicit unavailable state`, async ({ page }) => {
    await page.setViewportSize(size);
    await mount(page);
    await page.evaluate(() => window.__snapshotStatus.update({ state: "stale", fetchedAt: "2026-07-14T00:00:00.000Z" }));
    const indicator = page.locator("#snapshot-status");
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText("Potentially outdated");
    await expect(indicator).toContainText("14 Jul 2026");
    await expect(page.locator("#snapshot-status")).toHaveCount(1);
    const box = await indicator.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);

    await page.evaluate(() => window.__snapshotStatus.update({ state: "fresh" }));
    await expect(indicator).toBeHidden();
    await page.evaluate(() => window.__snapshotStatus.update({ state: "unavailable" }));
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText("Event information unavailable");
    await expect(indicator).toHaveAttribute("data-state", "unavailable");
  });
}

test("a recovered active snapshot reconciles events in place and later outages preserve them", async ({ page }) => {
  let available = true;
  const metadata = {
    snapshotId: "recovered", publishedAt: "2026-07-14T00:00:00.000Z", contentHash: "a".repeat(64),
    landmarksRef: "/api/snapshot/assets/recovered/landmarks.json",
    poisRef: "/api/snapshot/assets/recovered/pois.json",
    tilesetRef: "/api/snapshot/assets/recovered/tileset.json",
  };
  const landmarks = [{
    id: "recovered-hall", label: "Recovered Hall", anchor: { lat: 1.285, lng: 103.855 },
    events: [{ id: "recovered-event", title: "Recovered event", dateText: "14 Jul 2026", timeText: "19:00" }],
  }];
  const unavailable = (route) => route.fulfill({ status: 503, json: { schemaVersion: "1.0", error: { code: "source_unavailable", message: "Unavailable" } } });
  await page.route("**/api/snapshot", (route) => available
    ? route.fulfill({ json: { schemaVersion: "1.0", data: metadata, fetchedAt: metadata.publishedAt, stale: false, warning: null, source: { id: "approved-snapshot", costClass: "free" } } })
    : unavailable(route));
  await page.route("**/api/snapshot/assets/recovered/landmarks.json", (route) => available
    ? route.fulfill({ json: { schemaVersion: "1.0", data: landmarks, fetchedAt: metadata.publishedAt, stale: false, warning: null, source: { id: "approved-snapshot", costClass: "free" } } })
    : unavailable(route));
  await page.route("**/api/snapshot/assets/recovered/pois.json", (route) => available
    ? route.fulfill({ json: { schemaVersion: "1.0", data: [], fetchedAt: metadata.publishedAt, stale: false, warning: null, source: { id: "approved-snapshot", costClass: "free" } } })
    : unavailable(route));
  await page.route("**/api/snapshot/assets/recovered/tileset.json", (route) => route.fulfill({
    json: { asset: { version: "1.0" }, geometricError: 0, root: { boundingVolume: { region: [1.8, 0.02, 1.82, 0.03, 0, 1] }, geometricError: 0 } },
  }));
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await expect.poll(() => page.locator("body").getAttribute("data-landmark-event-pills")).toBe("mounted");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")));
  await expect.poll(() => page.locator("body").evaluate((body) => ({
    id: body.dataset.snapshotId || null,
    error: body.dataset.snapshotError || null,
    state: body.dataset.snapshotState || null,
  }))).toEqual({ id: "recovered", error: null, state: "fresh" });
  await expect(page.locator(".landmark-event-pill")).toHaveCount(1);
  await expect(page.locator("body")).toHaveAttribute("data-snapshot-reconciled", "updated");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")));
  await expect(page.locator("body")).toHaveAttribute("data-snapshot-reconciled", "noop");
  available = false;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")));
  await expect(page.locator("#snapshot-status")).toContainText("Potentially outdated");
  await expect(page.locator(".landmark-event-pill")).toHaveCount(1);
});
