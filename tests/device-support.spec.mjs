import { expect, test } from "playwright/test";

test("phones stop before the 3D application loads while larger screens continue", async ({
  page,
}, testInfo) => {
  const mobileProject = testInfo.project.name.endsWith("-mobile");
  const analyticsRequests = [];
  page.on("request", (request) => {
    if (
      /cloudflareinsights|google-analytics|googletagmanager|mixpanel|segment\.com/i.test(
        request.url(),
      )
    )
      analyticsRequests.push(request.url());
  });
  await page.goto("/?autoStart");

  await expect(page).toHaveTitle("Amble: See What’s Happening in Singapore");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://amblefinds.com/",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /interactive desktop map/,
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

  if (mobileProject) {
    await expect(page.locator("body")).toHaveAttribute(
      "data-device-support",
      "unsupported",
    );
    await expect(
      page.getByRole("heading", {
        name: "Singapore is waiting on the big screen",
      }),
    ).toBeVisible();
    await expect(page.locator("#device-gate")).toBeVisible();
    await expect(page.locator("#map")).toHaveCount(0);
    await expect(page.locator("#experience-intro")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        mapCreated: Boolean(window._map),
        mapLibreRequested: performance
          .getEntriesByType("resource")
          .some(({ name }) => /maplibre|main-[^/]+\.js/.test(name)),
      })),
    ).toEqual({ mapCreated: false, mapLibreRequested: false });
    return;
  }

  await expect(page.locator("body")).toHaveAttribute(
    "data-device-support",
    "supported",
  );
  await expect(page.locator("#device-gate")).toHaveCount(0);
  await expect(page.locator("#map")).toHaveCount(1);
  await page.evaluate(() => window._map?.remove());
});
