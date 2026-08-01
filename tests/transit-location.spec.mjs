import { expect, test } from "playwright/test";

const assistant = {
  open: '[data-testid="assistant-open"]',
  voiceState: '[data-testid="assistant-voice-state"]',
};

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
});

async function installProtocolHarness(page) {
  const admissionBodies = [];
  const browserMessages = [];
  let sendToBrowser = null;
  await page.addInitScript(() =>
    localStorage.setItem("amble.voice-disclosure.v1", "accepted"),
  );
  await page.route("**/api/voice/sessions", async (route) => {
    admissionBodies.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "transit-location-voice-session",
          protocolVersion: "1.1",
          streamPath:
            "/api/voice/sessions/transit-location-voice-session/stream",
          limits: {
            maxResponseStagesPerTurn: 3,
            responseTimeoutSeconds: 30,
          },
        },
      }),
    });
  });
  await page.routeWebSocket(
    "**/api/voice/sessions/transit-location-voice-session/stream",
    (socket) => {
      sendToBrowser = (event) => socket.send(JSON.stringify(event));
      socket.onMessage((raw) => {
        browserMessages.push(JSON.parse(String(raw)));
      });
      socket.send(
        JSON.stringify({ type: "session.state", state: "listening" }),
      );
    },
  );
  const messages = (type) =>
    browserMessages.filter((message) => message.type === type);
  const latestContext = () => messages("context.update").at(-1)?.context;
  const proposeLayerVisibility = async ({
    callId,
    layer,
    visible,
    contextRevision,
  }) => {
    sendToBrowser({
      type: "capability.proposed",
      callId,
      capabilityId: "map.setlayervisibility",
      kind: "command",
      arguments: { layer, visible },
      contextRevision,
    });
    await expect
      .poll(() =>
        messages("capability.result").find(
          (message) => message.callId === callId,
        ),
      )
      .toBeTruthy();
    const response = messages("capability.result").find(
      (message) => message.callId === callId,
    );
    expect(response.capabilityId).toBe("map.setlayervisibility");
    expect(response.kind).toBe("command");
    expect(response.result.changed).toBe(true);
    expect(response.result.contextRevision).toBeGreaterThan(contextRevision);
    await expect
      .poll(() => latestContext()?.revision)
      .toBeGreaterThanOrEqual(response.result.contextRevision);
    sendToBrowser({
      type: "capability.completed",
      callId,
      capabilityId: response.capabilityId,
      kind: response.kind,
      result: response.result,
    });
    return {
      result: response.result,
      context: structuredClone(latestContext()),
    };
  };
  return {
    admissionBodies,
    browserMessages,
    latestContext,
    messages,
    proposeLayerVisibility,
    send(event) {
      sendToBrowser?.(event);
    },
    ready: () => typeof sendToBrowser === "function",
  };
}

async function startVoice(page, harness) {
  await page.locator(assistant.open).click();
  await expect.poll(harness.ready).toBe(true);
  await expect(page.locator(assistant.voiceState)).toContainText(/listening/i);
  await expect.poll(() => harness.messages("context.update").length).toBe(1);
}

const mapReady = (page) =>
  page.evaluate(() => Boolean(window._map)).catch(() => false);

test("mobile map always shows distinct MRT context and the available user location", async ({
  page,
}) => {
  await page.goto("/?emptyApprovedSnapshot#11/1.35/103.82/0/0");
  await expect
    .poll(
      () =>
        page
          .evaluate(() => Boolean(window._map?.getLayer("mrt-lines-context")))
          .catch(() => false),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .evaluate(() => Boolean(window._map?.getLayer("mrt-stations-context")))
        .catch(() => false),
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
  const harness = await installProtocolHarness(page);
  await page.goto("/?emptyApprovedSnapshot#11/1.35/103.82/0/0");
  await expect
    .poll(() => mapReady(page), {
      timeout: 15_000,
    })
    .toBe(true);
  await startVoice(page, harness);
  expect(harness.admissionBodies).toEqual([
    {
      protocolVersion: "1.1",
      disclosureAccepted: true,
      capabilities: { audioInput: true, audioOutput: true, text: true },
    },
  ]);

  const initialContext = structuredClone(harness.latestContext());
  expect(initialContext.location).toEqual({
    permission: "granted",
    status: "fresh",
    coarseAreaId: expect.any(String),
  });
  expect(initialContext.transit).toEqual({
    visible: true,
    constraintActive: false,
  });

  const serializedInitialContext = JSON.stringify(initialContext);
  for (const exactField of [
    "coordinates",
    "longitude",
    "latitude",
    "accuracy",
    "accuracyMeters",
    "timestamp",
  ])
    expect(serializedInitialContext).not.toContain(`"${exactField}"`);

  await page
    .locator('[data-capability-id="map.zoomin"]')
    .dispatchEvent("click");
  await expect
    .poll(() => harness.latestContext()?.revision)
    .toBeGreaterThan(initialContext.revision);
  const directRevision = harness.latestContext().revision;
  expect(directRevision).toBeGreaterThan(initialContext.revision);
  expect(harness.latestContext().location).toEqual(initialContext.location);
  expect(harness.latestContext().transit).toEqual(initialContext.transit);

  let proposalRevision = directRevision;
  const transitions = [
    ["location", false],
    ["location", true],
    ["mrtStations", false],
    ["mrtLines", false],
    ["mrtStations", true],
    ["mrtLines", true],
  ];
  for (const [index, [layer, visible]] of transitions.entries()) {
    const transition = await harness.proposeLayerVisibility({
      callId: `layer-${index + 1}`,
      layer,
      visible,
      contextRevision: proposalRevision,
    });
    expect(transition.context.revision).toBeGreaterThan(proposalRevision);
    expect(transition.context.visibleLayers[layer]).toBe(visible);
    expect(transition.context.transit.constraintActive).toBe(false);
    proposalRevision = transition.context.revision;

    if (layer === "location")
      expect(
        await page.evaluate(
          () => document.body.dataset.locationVisible === "true",
        ),
      ).toBe(visible);
    if (layer === "mrtLines")
      expect(
        await page.evaluate(
          () =>
            window._map.getLayoutProperty("mrt-lines-context", "visibility") !==
            "none",
        ),
      ).toBe(visible);
    if (layer === "mrtStations")
      expect(
        await page.evaluate(
          () =>
            window._map.getLayoutProperty(
              "mrt-stations-context",
              "visibility",
            ) !== "none",
        ),
      ).toBe(visible);
  }

  expect(harness.latestContext().transit).toEqual({
    visible: true,
    constraintActive: false,
  });
  harness.send({
    type: "transcript.final",
    itemId: "transit-request-001",
    role: "user",
    modality: "audio",
    text: "Only suggest areas convenient to MRT",
  });
  await expect
    .poll(() => harness.latestContext()?.revision)
    .toBeGreaterThan(proposalRevision);
  await expect
    .poll(() =>
      page.evaluate(() => document.body.dataset.transitConstraintActive),
    )
    .toBe("true");
  expect(harness.latestContext().transit).toEqual({
    visible: true,
    constraintActive: true,
  });

  for (const message of harness.messages("context.update")) {
    expect(Object.keys(message.context.location).sort()).toEqual([
      "coarseAreaId",
      "permission",
      "status",
    ]);
    expect(JSON.stringify(message.context)).not.toMatch(
      /"(?:coordinates|longitude|latitude|accuracy|accuracyMeters|timestamp)"/,
    );
  }
});
