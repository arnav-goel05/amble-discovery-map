import { expect, test } from "playwright/test";

async function mount(page) {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createSnapshotStatus } =
      await import("/activity-scenes/snapshot-status.js");
    window.__snapshotStatus = createSnapshotStatus();
  });
}

for (const [name, size] of [
  ["desktop", { width: 1280, height: 800 }],
  ["mobile", { width: 390, height: 760 }],
]) {
  test(`${name} hides stale snapshot metadata and shows an explicit unavailable state`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await mount(page);
    await page.evaluate(() =>
      window.__snapshotStatus.update({
        state: "stale",
        fetchedAt: "2026-07-14T00:00:00.000Z",
      }),
    );
    const indicator = page.locator("#snapshot-status");
    await expect(indicator).toBeHidden();
    await expect(indicator).toBeEmpty();
    await expect(page.locator("#snapshot-status")).toHaveCount(1);

    await page.evaluate(() =>
      window.__snapshotStatus.update({ state: "fresh" }),
    );
    await expect(indicator).toBeHidden();
    await page.evaluate(() =>
      window.__snapshotStatus.update({ state: "unavailable" }),
    );
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText("Event information unavailable");
    await expect(indicator).toHaveAttribute("data-state", "unavailable");
  });
}

test("a recovered active snapshot reconciles events in place and later outages preserve them", async ({
  page,
}) => {
  let available = true;
  const metadata = {
    snapshotId: "recovered",
    publishedAt: "2026-07-14T00:00:00.000Z",
    contentHash: "a".repeat(64),
    landmarksRef: "/api/snapshot/assets/recovered/landmarks.json",
    poisRef: "/api/snapshot/assets/recovered/pois.json",
    tilesetRef: "/api/snapshot/assets/recovered/tileset.json",
    activitiesRef: "/api/snapshot/assets/recovered/activities.json",
  };
  const landmarks = [
    {
      id: "recovered-hall",
      label: "Recovered Hall",
      anchor: { lat: 1.285, lng: 103.855 },
      activityRefs: [
        {
          activityId: "activity:recovered",
          venueGroupIds: ["venue-group:recovered"],
        },
      ],
    },
  ];
  const activities = {
    schemaVersion: "1.0",
    records: [
      {
        schemaVersion: "1.0",
        activityId: "activity:recovered",
        title: "Recovered event",
        description: null,
        category: null,
        organizer: null,
        price: null,
        lifecycleState: "active",
        freshness: "current",
        sources: ["Recovered source"],
        sessions: [
          {
            sessionId: "session:recovered",
            schedule: {
              kind: "exact",
              start: "2026-07-14T19:00:00+08:00",
              end: "2026-07-14T20:00:00+08:00",
              recurrence: null,
              displayText: "14 Jul 2026",
              finalKnownOccurrence: "2026-07-14T20:00:00+08:00",
            },
            availability: "unknown",
            venueGroupIds: ["venue-group:recovered"],
          },
        ],
        venueGroups: [
          {
            venueGroupId: "venue-group:recovered",
            activityId: "activity:recovered",
            label: "Recovered Hall",
            address: null,
            publicPlacement: "mapped",
            mappingStatus: "approved",
            approvedLocationId: "recovered-hall",
            coordinates: { lat: 1.285, lng: 103.855 },
            sessionIds: ["session:recovered"],
          },
        ],
        sourceOffers: [],
        scheduleSummary: {
          kind: "exact",
          label: "14 Jul 2026, 7pm",
          sessionCount: 1,
        },
      },
    ],
  };
  const unavailable = (route) =>
    route.fulfill({
      status: 503,
      json: {
        schemaVersion: "1.0",
        error: { code: "source_unavailable", message: "Unavailable" },
      },
    });
  await page.route("**/api/snapshot", (route) =>
    available
      ? route.fulfill({
          json: {
            schemaVersion: "1.0",
            data: metadata,
            fetchedAt: metadata.publishedAt,
            stale: false,
            warning: null,
            source: { id: "approved-snapshot", costClass: "free" },
          },
        })
      : unavailable(route),
  );
  await page.route(
    "**/api/snapshot/assets/recovered/landmarks.json",
    (route) =>
      available
        ? route.fulfill({
            json: {
              schemaVersion: "1.0",
              data: landmarks,
              fetchedAt: metadata.publishedAt,
              stale: false,
              warning: null,
              source: { id: "approved-snapshot", costClass: "free" },
            },
          })
        : unavailable(route),
  );
  await page.route("**/api/snapshot/assets/recovered/pois.json", (route) =>
    available
      ? route.fulfill({
          json: {
            schemaVersion: "1.0",
            data: [],
            fetchedAt: metadata.publishedAt,
            stale: false,
            warning: null,
            source: { id: "approved-snapshot", costClass: "free" },
          },
        })
      : unavailable(route),
  );
  await page.route(
    "**/api/snapshot/assets/recovered/activities.json",
    (route) =>
      available
        ? route.fulfill({
            json: {
              schemaVersion: "1.0",
              data: activities,
              fetchedAt: metadata.publishedAt,
              stale: false,
              warning: null,
              source: { id: "approved-snapshot", costClass: "free" },
            },
          })
        : unavailable(route),
  );
  await page.route("**/api/snapshot/assets/recovered/tileset.json", (route) =>
    route.fulfill({
      json: {
        asset: { version: "1.0" },
        geometricError: 0,
        root: {
          boundingVolume: { region: [1.8, 0.02, 1.82, 0.03, 0, 1] },
          geometricError: 0,
        },
      },
    }),
  );
  await page.goto("/?emptyApprovedSnapshot");
  await expect
    .poll(() => page.locator("body").getAttribute("data-landmark-event-pills"))
    .toBe("mounted");
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")),
  );
  await expect
    .poll(() =>
      page.locator("body").evaluate((body) => ({
        id: body.dataset.snapshotId || null,
        error: body.dataset.snapshotError || null,
        state: body.dataset.snapshotState || null,
      })),
    )
    .toEqual({ id: "recovered", error: null, state: "fresh" });
  await expect(page.locator(".landmark-event-pill")).toHaveCount(1);
  await expect(page.locator("body")).toHaveAttribute(
    "data-snapshot-reconciled",
    "updated",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")),
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-snapshot-reconciled",
    "noop",
  );
  available = false;
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("whats-here:snapshot-refresh")),
  );
  await expect(page.locator("#snapshot-status")).toBeHidden();
  await expect(page.locator("#snapshot-status")).toBeEmpty();
  await expect(page.locator(".landmark-event-pill")).toHaveCount(1);
});
