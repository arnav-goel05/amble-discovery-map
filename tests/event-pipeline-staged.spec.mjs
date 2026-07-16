import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'playwright/test';

const runDir = process.env.EVENT_PIPELINE_RUN_DIR;
test.skip(!runDir, 'EVENT_PIPELINE_RUN_DIR is required for staged snapshot verification');

const pois = runDir ? JSON.parse(fs.readFileSync(path.join(runDir, 'frontend/approved-pois.json'), 'utf8')).records : [];
const landmarks = runDir ? JSON.parse(fs.readFileSync(path.join(runDir, 'frontend/approved-landmarks.json'), 'utf8')).records : [];
const relativeRun = runDir ? path.relative(process.cwd(), runDir).split(path.sep).join('/') : '';
const stagedPois = pois.map((poi) => ({ ...poi, data: fs.existsSync(path.join(runDir, 'frontend/assets/public', poi.data)) ? `${relativeRun}/frontend/assets/public/${poi.data}` : poi.data }));
const stagedBackground = runDir && fs.existsSync(path.join(runDir, 'frontend/verification-assets/background-tileset.json'))
  ? `${relativeRun}/frontend/verification-assets/background-tileset.json` : 'optimized-tiles/tileset.json';
const stagedCombinedPois = runDir && fs.existsSync(path.join(runDir, 'frontend/assets/public/poi-tiles/event-venues/tileset.json'))
  ? `${relativeRun}/frontend/assets/public/poi-tiles/event-venues/tileset.json` : 'poi-tiles/event-venues/tileset.json';
if (runDir) fs.mkdirSync(path.join(runDir, 'frontend/evidence'), { recursive: true });
const pill = (page, landmark) => page.locator(`[id=${JSON.stringify(`${landmark.id}-event-pill`)}]`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((snapshot) => { globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot; }, {
    snapshotId: path.basename(runDir), pois: stagedPois, landmarks,
    backgroundTilesetUrl: stagedBackground,
    poiTilesetUrl: stagedCombinedPois,
  });
});

test('staged successful snapshot mounts every landmark once and opens the shared panel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?autoStart#17/1.285844/103.857897/-30/60');
  await expect.poll(() => page.locator('body').getAttribute('data-poi-highlight-manager')).toBe('combined');
  await expect(page.locator('body')).toHaveAttribute('data-snapshot-id', path.basename(runDir));
  const separation = await page.locator('body').evaluate((body) => ({
    excluded: body.dataset.backgroundPoiExcluded?.split(',').filter(Boolean) ?? [],
    highlighted: body.dataset.poiFullOpacity?.split(',').filter(Boolean) ?? [],
  }));
  expect(separation.excluded.toSorted()).toEqual(separation.highlighted.toSorted());
  await expect(page.locator('.landmark-event-pill')).toHaveCount(landmarks.length);
  for (const landmark of landmarks) await expect(pill(page, landmark)).toHaveCount(1);
  if (landmarks.length) {
    const trigger = pill(page, landmarks[0]).locator('.landmark-event-pill__card');
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.locator('#landmark-event-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await expect(page.locator('body')).not.toHaveAttribute('data-tile-error-count', /[1-9]/);
  await expect(page.locator('body')).not.toHaveAttribute('data-poi-tile-error-count', /[1-9]/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(runDir, 'frontend/evidence/staged-wide.png'), fullPage: true });
});

test('staged stale metadata is visible without publishing the candidate over the previous snapshot', async ({ page, request }) => {
  const before = await request.get('/api/snapshot');
  expect(before.ok()).toBeTruthy();
  const activeBefore = (await before.json()).data.snapshotId;
  expect(activeBefore).not.toBe(path.basename(runDir));

  await page.addInitScript(() => { globalThis.__EVENT_PIPELINE_SNAPSHOT__.stale = true; });
  await page.goto('/?autoStart#17/1.285844/103.857897/-30/60');
  await expect(page.locator('body')).toHaveAttribute('data-snapshot-state', 'potentially-outdated');
  await expect(page.locator('#snapshot-freshness')).toContainText(/potentially outdated/i);

  const after = await request.get('/api/snapshot');
  expect((await after.json()).data.snapshotId).toBe(activeBefore);
});

test('staged panel remains usable at a narrow viewport', async ({ page }) => {
  test.skip(!landmarks.length, 'No staged landmarks');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?autoStart#17/1.285844/103.857897/-30/60');
  await pill(page, landmarks[0]).locator('.landmark-event-pill__card').click();
  const panel = page.locator('#landmark-event-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /close/i })).toBeVisible();
  expect(await panel.locator('.landmark-event-panel__field').count()).toBeGreaterThan(0);
  await expect(panel).not.toContainText(/(?:undefined|null)/i);
  await page.screenshot({ path: path.join(runDir, 'frontend/evidence/staged-narrow.png'), fullPage: true });
});
