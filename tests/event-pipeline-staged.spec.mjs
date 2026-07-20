import fs from "node:fs";
import path from "node:path";
import { expect, test } from "playwright/test";

const runDir = process.env.EVENT_PIPELINE_RUN_DIR;
test.skip(
  !runDir,
  "EVENT_PIPELINE_RUN_DIR is required for staged snapshot verification",
);

const pois = runDir
  ? JSON.parse(
      fs.readFileSync(path.join(runDir, "frontend/approved-pois.json"), "utf8"),
    ).records
  : [];
const landmarks = runDir
  ? JSON.parse(
      fs.readFileSync(
        path.join(runDir, "frontend/approved-landmarks.json"),
        "utf8",
      ),
    ).records
  : [];
const verificationOrigin =
  process.env.EVENT_PIPELINE_BROWSER_ORIGIN ?? "http://127.0.0.1:4174";
const viteFsUrl = (value) =>
  new URL(
    `/@fs${path.resolve(value).split(path.sep).join("/")}`,
    verificationOrigin,
  ).href;
const stagedPois = pois.map((poi) => ({
  ...poi,
  data: fs.existsSync(path.join(runDir, "frontend/assets/public", poi.data))
    ? viteFsUrl(path.join(runDir, "frontend/assets/public", poi.data))
    : poi.data,
}));
const stagedBackground =
  runDir &&
  fs.existsSync(
    path.join(runDir, "frontend/verification-assets/background-tileset.json"),
  )
    ? viteFsUrl(
        path.join(
          runDir,
          "frontend/verification-assets/background-tileset.json",
        ),
      )
    : new URL("/optimized-tiles/tileset.json", verificationOrigin).href;
const stagedCombinedPois =
  runDir &&
  fs.existsSync(
    path.join(
      runDir,
      "frontend/assets/public/poi-tiles/event-venues/tileset.json",
    ),
  )
    ? viteFsUrl(
        path.join(
          runDir,
          "frontend/assets/public/poi-tiles/event-venues/tileset.json",
        ),
      )
    : new URL("/poi-tiles/event-venues/tileset.json", verificationOrigin).href;
if (runDir)
  fs.mkdirSync(path.join(runDir, "frontend/evidence"), { recursive: true });
const pill = (page, landmark) =>
  page.locator(`[id=${JSON.stringify(`${landmark.id}-event-pill`)}]`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (snapshot) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
    },
    {
      snapshotId: path.basename(runDir),
      pois: stagedPois,
      landmarks,
      backgroundTilesetUrl: stagedBackground,
      poiTilesetUrl: stagedCombinedPois,
    },
  );
});

test("staged successful snapshot mounts every landmark once and opens the shared panel", async ({
  page,
}) => {
  const errors = [];
  const htmlAssetFallbacks = [];
  page.on("pageerror", (error) => {
    if (error.message !== "Failed to fetch") errors.push(error.message);
  });
  page.on("response", (response) => {
    if (
      /\.(?:json|b3dm|glb)(?:\?|$)/i.test(response.url()) &&
      (response.headers()["content-type"] ?? "").includes("text/html")
    )
      htmlAssetFallbacks.push(response.url());
  });
  await page.goto("/?autoStart#17/1.285844/103.857897/-30/60");
  await expect
    .poll(
      () => page.locator("body").getAttribute("data-poi-highlight-manager"),
      { timeout: 30_000 },
    )
    .toBe("combined");
  await expect(page.locator("body")).toHaveAttribute(
    "data-snapshot-id",
    path.basename(runDir),
  );
  const separation = await page.locator("body").evaluate((body) => ({
    excluded:
      body.dataset.backgroundPoiExcluded?.split(",").filter(Boolean) ?? [],
    highlighted: body.dataset.poiFullOpacity?.split(",").filter(Boolean) ?? [],
  }));
  expect(separation.excluded.toSorted()).toEqual(
    separation.highlighted.toSorted(),
  );
  await expect(page.locator(".landmark-event-pill")).toHaveCount(
    landmarks.length,
    { timeout: 45_000 },
  );
  const mountedPillIds = await page
    .locator(".landmark-event-pill")
    .evaluateAll((nodes) => nodes.map((node) => node.id).toSorted());
  expect(mountedPillIds).toEqual(
    landmarks.map((landmark) => `${landmark.id}-event-pill`).toSorted(),
  );
  if (landmarks.length) {
    const trigger = pill(page, landmarks[0]).locator(
      ".landmark-event-pill__card",
    );
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.locator("#landmark-event-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-tile-error-count",
    /[1-9]/,
  );
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-poi-tile-error-count",
    /[1-9]/,
  );
  expect(errors).toEqual([]);
  expect(htmlAssetFallbacks).toEqual([]);
  await page.screenshot({
    path: path.join(runDir, "frontend/evidence/staged-wide.png"),
    fullPage: true,
  });
});

test("staged stale metadata is visible without publishing the candidate over the previous snapshot", async ({
  page,
  request,
}) => {
  const before = await request.get("/api/snapshot");
  expect(before.ok()).toBeTruthy();
  const activeBefore = (await before.json()).data.snapshotId;
  expect(activeBefore).not.toBe(path.basename(runDir));

  await page.addInitScript(() => {
    globalThis.__EVENT_PIPELINE_SNAPSHOT__.stale = true;
  });
  await page.goto("/?autoStart#17/1.285844/103.857897/-30/60");
  await expect(page.locator("body")).toHaveAttribute(
    "data-snapshot-state",
    "potentially-outdated",
  );
  await expect(page.locator("#snapshot-freshness")).toContainText(
    /potentially outdated/i,
  );

  const after = await request.get("/api/snapshot");
  expect((await after.json()).data.snapshotId).toBe(activeBefore);
});

test("staged panel remains usable at a narrow viewport", async ({ page }) => {
  test.skip(!landmarks.length, "No staged landmarks");
  await page.goto("/?autoStart#17/1.285844/103.857897/-30/60");
  await expect(page.locator(".landmark-event-pill")).toHaveCount(
    landmarks.length,
    { timeout: 45_000 },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.locator(".landmark-event-pill__card:visible").first();
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await trigger.press("Enter");
  const panel = page.locator("#landmark-event-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /close/i })).toBeVisible();
  expect(
    await panel.locator(".landmark-event-panel__field").count(),
  ).toBeGreaterThan(0);
  await expect(panel).not.toContainText(/(?:undefined|null)/i);
  await page.screenshot({
    path: path.join(runDir, "frontend/evidence/staged-narrow.png"),
    fullPage: true,
  });
});
