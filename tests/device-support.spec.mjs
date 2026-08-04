import { expect, test } from "playwright/test";

const DESKTOP_APPLICATION_TIMEOUT = 20_000;

test("phones stop at the device gate while larger screens enter the application", async ({
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
    await expect(page.locator("#map-brand")).toHaveCount(0);
    await expect(page.locator("#experience-intro")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        mapCreated: Boolean(window._map),
        applicationRequested: performance
          .getEntriesByType("resource")
          .some(({ name }) => new URL(name).pathname === "/main.js"),
        gateFitsViewport: (() => {
          const gate = document
            .getElementById("device-gate")
            ?.getBoundingClientRect();
          return Boolean(
            gate &&
            gate.width <= window.innerWidth + 1 &&
            gate.height <= window.innerHeight + 1,
          );
        })(),
        cardIntersectsViewport: (() => {
          const card = document
            .querySelector(".device-gate__card")
            ?.getBoundingClientRect();
          return Boolean(
            card &&
            card.bottom > 0 &&
            card.top < window.innerHeight &&
            card.right > 0 &&
            card.left < window.innerWidth,
          );
        })(),
      })),
    ).toEqual({
      mapCreated: false,
      applicationRequested: false,
      gateFitsViewport: true,
      cardIntersectsViewport: true,
    });
    return;
  } else {
    await expect(page.locator("body")).toHaveAttribute(
      "data-device-support",
      "supported",
    );
    await expect(page.locator("#device-gate")).toHaveCount(0);
    await expect(page.locator("#map")).toHaveCount(1);
    await expect(page.locator("#map")).toBeVisible({
      timeout: DESKTOP_APPLICATION_TIMEOUT,
    });
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
  }
  await page.evaluate(() => window._map?.remove());
});
