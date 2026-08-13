import { expect, test } from "playwright/test";

test("the initial wordmarks are bounded before application JavaScript loads", async ({
  page,
}) => {
  await page.route("**/app-entry.js", (route) => route.abort());
  await page.goto("/");

  const intro = page.locator("#experience-intro");
  const wordmark = page.locator(".experience-intro__wordmark");
  await expect(intro).toHaveCSS("position", "fixed");
  await expect(intro).toHaveCSS("font-family", /Arial|sans-serif/);
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveAttribute("width", "300");
  await expect(wordmark).toHaveAttribute("height", "95");
  expect(
    await wordmark.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(300);
  await expect(page.locator("#map-brand")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByText("Bringing Singapore into view")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Let's explore" })).toBeHidden(
  );
});

test("the intro has no artificial minimum once the scene is ready", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    window.__experienceIntro = createExperienceIntro({
      sceneReady: () => true,
    });
  });

  await expect(
    page.getByRole("button", { name: "Let's explore" }),
  ).toBeVisible();
  await expect(page.locator("#experience-intro")).toHaveAttribute(
    "data-ready-reason",
    "scene-ready",
  );
});

test("the intro waits for initial 3D content and fades away on entry", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    window.__introEnterCount = 0;
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      readySettleMs: 40,
      onEnter: () => {
        window.__introEnterCount += 1;
      },
    });
  });

  const intro = page.locator("#experience-intro");
  await expect(intro).toBeVisible();
  await expect(page.locator(".experience-intro__wordmark")).toBeVisible();
  await expect(page.locator(".experience-intro__wordmark")).toHaveAttribute(
    "src",
    "/brand/amble-wordmark.png",
  );
  await expect(
    page.getByRole("heading", {
      name: "There is too much happening in Singapore, you just didn't know it",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Let's explore" }),
  ).toBeHidden();

  await page.evaluate(() => {
    Object.assign(document.body.dataset, {
      mapLoaded: "true",
      buildingsLayerStarted: "true",
      tilesetLoaded: "true",
      backgroundViewLoaded: "true",
    });
  });

  const enter = page.getByRole("button", { name: "Let's explore" });
  await expect(enter).toBeVisible();
  await expect(page.getByText("Bringing Singapore into view")).toBeHidden();
  await expect(enter).not.toBeFocused();
  await expect(page.locator("body")).toHaveAttribute(
    "data-experience-intro",
    "ready",
  );
  await enter.click();
  expect(await page.evaluate(() => window.__introEnterCount)).toBe(1);
  await expect(intro).toHaveClass(/is-leaving/);
  await expect(intro).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator("body")).toHaveAttribute(
    "data-experience-intro",
    "complete",
  );
});

test("the ready state must remain stable before entry is offered", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    window.__sceneReady = false;
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      readySettleMs: 100,
      sceneReady: () => window.__sceneReady,
    });
  });
  const enter = page.getByRole("button", { name: "Let's explore" });
  await page.evaluate(() => {
    window.__sceneReady = true;
  });
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    window.__sceneReady = false;
  });
  await expect(enter).toBeHidden();
  await page.evaluate(() => {
    window.__sceneReady = true;
  });
  await expect(enter).toBeVisible();
});

test("the intro keeps waiting when the initial 3D scene does not become ready", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      sceneReady: () => false,
    });
  });

  const enter = page.getByRole("button", { name: "Let's explore" });
  await page.waitForTimeout(150);
  await expect(enter).toBeHidden();
  await expect(page.getByText("Bringing Singapore into view")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-experience-intro",
    "loading",
  );
});

test("a genuine startup failure offers retry instead of entry", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    window.__sceneFailure = null;
    window.__retryCount = 0;
    window.__experienceIntro = createExperienceIntro({
      pollIntervalMs: 10,
      sceneReady: () => false,
      sceneFailure: () => window.__sceneFailure,
      onRetry: () => {
        window.__retryCount += 1;
      },
    });
    window.__sceneFailure = "application_start_failed";
  });

  await expect(
    page.getByText(
      "Singapore couldn't finish loading. Check your connection and try again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Let's explore" }),
  ).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute(
    "data-experience-intro",
    "error",
  );
  await expect(page.locator("#experience-intro")).toHaveAttribute(
    "data-failure-reason",
    "application_start_failed",
  );

  await page.getByRole("button", { name: "Try again" }).click();
  expect(await page.evaluate(() => window.__retryCount)).toBe(1);
});

test("internal skip mode can bypass the first-load experience", async ({
  page,
}) => {
  await page.goto("/test-harness.html");
  const state = await page.evaluate(async () => {
    const { createExperienceIntro } =
      await import("/activity-scenes/experience-intro.js");
    createExperienceIntro({ skip: true });
    return document.body.dataset.experienceIntro;
  });
  expect(state).toBe("skipped");
  await expect(page.locator("#experience-intro")).toHaveCount(0);
});
