import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const position = {
      coords: { longitude: 103.851, latitude: 1.293, accuracy: 25 },
      timestamp: Date.now(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (resolve) => resolve(position),
        watchPosition: (resolve) => {
          resolve(position);
          return 1;
        },
        clearWatch: () => {},
      },
    });
    const track = {
      readyState: "live",
      stop() {
        this.readyState = "ended";
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
  });
  await page.goto("/?autoStart&emptyApprovedSnapshot#11/1.35/103.82/0/0");
});

test("mobile map always shows distinct MRT context and the available user location", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(window._map?.getLayer("mrt-lines-context"))),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window._map?.getLayer("mrt-stations-context")),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.locationState))
    .toBe("fresh");
  const locationFeatures = await page.evaluate(
    () => window._map.getSource("user-location-context")._data.features,
  );
  expect(
    locationFeatures.map(({ properties }) => properties.presentation),
  ).toEqual(["accuracy", "point"]);
  await expect(page.locator(".location-context-controls")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window._map.getLayoutProperty("mrt-lines-context", "visibility"),
    ),
  ).not.toBe("none");
});

test("MRT visibility is visual-only until the user explicitly requests a transit constraint", async ({
  page,
}) => {
  const before = await page.evaluate(
    () => document.body.dataset.selectedDiscoveryArea || null,
  );
  expect(
    await page.evaluate(
      () => document.body.dataset.selectedDiscoveryArea || null,
    ),
  ).toBe(before);
  await page.route("**/api/voice/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "transit-voice-session",
          protocolVersion: "1.0",
          streamPath: "/api/voice/sessions/transit-voice-session/stream",
          expiresAt: "2026-07-18T12:05:00.000Z",
          limits: { maxSessionSeconds: 300, idleSeconds: 60, maxResponses: 6 },
        },
      }),
    }),
  );
  await page.routeWebSocket(
    "**/api/voice/sessions/transit-voice-session/stream",
    (socket) => {
      socket.send(
        JSON.stringify({ type: "session.state", state: "listening" }),
      );
      socket.send(
        JSON.stringify({
          type: "transcript.final",
          itemId: "transit-request-001",
          role: "user",
          modality: "audio",
          text: "Only suggest areas convenient to MRT",
        }),
      );
    },
  );
  await page.locator('[data-testid="assistant-open"]').click();
  await page.locator('[data-testid="assistant-disclosure-accept"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => document.body.dataset.transitConstraintActive),
    )
    .toBe("true");
});
