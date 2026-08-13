import { expect, test } from "playwright/test";

const DESKTOP_APPLICATION_TIMEOUT = 20_000;

test("phones and larger screens enter the application", async ({
  page,
}, testInfo) => {
  const mobileProject = testInfo.project.name.endsWith("-mobile");
  const primaryDesktopProject = testInfo.project.name === "chromium-desktop";
  const analyticsRequests = [];
  page.on("request", (request) => {
    if (
      /cloudflareinsights|google-analytics|googletagmanager|mixpanel|segment\.com/i.test(
        request.url(),
      )
    )
      analyticsRequests.push(request.url());
  });
  await page.goto("/");

  await expect(page).toHaveTitle("Amble: See What’s Happening in Singapore");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://amblefinds.com/",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /interactive map/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://amblefinds.com/brand/amble-social-card.png",
  );
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    1,
  );
  expect(analyticsRequests).toEqual([]);
  expect(
    await page.evaluate(() => ({
      cookies: document.cookie,
      analyticsKeys: [
        ...Object.keys(localStorage),
        ...Object.keys(sessionStorage),
      ].filter((key) =>
        /analytics|visitor|client.?id|_ga|mixpanel|segment/i.test(key),
      ),
    })),
  ).toEqual({ cookies: "", analyticsKeys: [] });

  await expect(page.locator("body")).toHaveAttribute(
    "data-device-support",
    "supported",
  );
  await expect(page.locator("#device-gate")).toHaveCount(0);
  await expect(page.locator("#map")).toHaveCount(1);
  await expect(page.locator("#map")).toBeVisible({
    timeout: DESKTOP_APPLICATION_TIMEOUT,
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(window._map)), {
      timeout: DESKTOP_APPLICATION_TIMEOUT,
    })
    .toBe(true);

  if (mobileProject) {
    const actionAlignment = await page
      .locator(".landmark-event-search__actions")
      .evaluate((actions) => {
        const bounds = actions.getBoundingClientRect();
        const buttons = [...actions.querySelectorAll("button")];
        const lastButtonBounds = buttons.at(-1)?.getBoundingClientRect();
        return {
          buttonBackgrounds: buttons.map(
            (button) => getComputedStyle(button).backgroundColor,
          ),
          justifyContent: getComputedStyle(actions).justifyContent,
          trailingGap: lastButtonBounds
            ? Math.round(bounds.right - lastButtonBounds.right)
            : null,
        };
      });
    expect(actionAlignment.justifyContent).toBe("flex-end");
    expect(actionAlignment.buttonBackgrounds).toEqual([
      "rgb(255, 255, 255)",
      "rgb(255, 255, 255)",
    ]);
    expect(actionAlignment.trailingGap).not.toBeNull();
    expect(actionAlignment.trailingGap).toBeLessThanOrEqual(8);
    await page.evaluate(() => window._map?.remove());
    return;
  }

  if (!primaryDesktopProject) {
    await page.evaluate(() => window._map?.remove());
    return;
  }
  await expect(page.locator("#event-density-minimap")).toBeVisible({
    timeout: DESKTOP_APPLICATION_TIMEOUT,
  });
  await expect(page.locator("#map-guidance")).toBeVisible({
    timeout: DESKTOP_APPLICATION_TIMEOUT,
  });

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator("body")).toHaveAttribute(
    "data-device-support",
    "supported",
  );
  await expect(page.locator("#device-gate")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#event-density-minimap")).toBeHidden();
  await expect(page.locator("#map-guidance")).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#event-density-minimap")).toBeVisible();
  await expect(page.locator("#map-guidance")).toBeVisible();
  await page.evaluate(() => window._map?.remove());
});
