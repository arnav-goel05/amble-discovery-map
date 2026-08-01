import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryText = fs.readFileSync(
  path.join(
    root,
    "specs/004-conversational-voice-map/contracts/public-action-inventory.md",
  ),
  "utf8",
);
const inventoryCapabilityIds = [
  ...inventoryText.matchAll(/^\|\s*`([a-z][a-z0-9]*\.[a-z][a-z0-9]*)`\s*\|/gm),
].map((match) => match[1]);
const activeInventoryIds = inventoryCapabilityIds.filter(
  (capabilityId) =>
    !capabilityId.startsWith("saved.") && !capabilityId.startsWith("game."),
);

const eventSnapshot = {
  snapshotId: "voice-action-fixture",
  pois: [],
  landmarks: [
    {
      id: "fixture-hall",
      label: "Fixture Hall",
      areaId: "ura-subzone:city-hall",
      anchor: { lng: 103.8579, lat: 1.2858 },
      events: [
        {
          id: "event-1",
          title: "Jazz by the Bay",
          venue: "Fixture Hall",
          dateText: "18 Jul 2026",
          areaId: "ura-subzone:city-hall",
          evidenceRefs: ["approved-event:event-1"],
        },
      ],
    },
  ],
  backgroundTilesetUrl: "tests/fixtures/empty-tileset.json",
  poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
};

const restaurant = {
  id: "osm-node-42",
  name: "Fixture Kitchen",
  category: "restaurant",
  cuisine: "singaporean",
  address: "3 Fixture Road",
  latitude: 1.285,
  longitude: 103.858,
  areaId: "ura-subzone:downtown-core",
  sourceSnapshotId: "restaurant-viewport:fixture",
  evidenceRefs: ["approved-restaurant:osm-node-42"],
};

const journeys = [
  {
    family: "app",
    capabilityId: "app.inspect",
    kind: "query",
    argumentsValue: {},
    utterance: "What can I currently do?",
    observe: () => Promise.resolve(),
  },
  {
    family: "catalog",
    capabilityId: "catalog.search",
    kind: "query",
    argumentsValue: { query: "Jazz", types: ["event"], limit: 20 },
    utterance: "Which approved jazz events are available?",
    observe: () => Promise.resolve(),
  },
  {
    family: "map",
    capabilityId: "map.zoomin",
    argumentsValue: {},
    utterance: "Zoom in",
    before: (page) => page.evaluate(() => window._map.getZoom()),
    observe: async (page, before) =>
      expect
        .poll(() => page.evaluate(() => window._map.getZoom()))
        .toBeGreaterThan(before),
  },
  {
    family: "tour",
    capabilityId: "tour.start",
    argumentsValue: {},
    utterance: "Show me the feature tour",
    observe: (page) => expect(page.locator("#feature-tour")).toBeVisible(),
  },
  {
    family: "event",
    capabilityId: "event.search",
    argumentsValue: { query: "Jazz" },
    utterance: "Search events for jazz",
    observe: (_page, _before, harness) =>
      expect
        .poll(
          () =>
            [...harness.browserMessages]
              .reverse()
              .find((message) => message.type === "context.update")?.context
              ?.activeFilters?.eventQuery,
        )
        .toBe("jazz"),
  },
  {
    family: "restaurant",
    capabilityId: "restaurant.searchviewport",
    argumentsValue: {},
    utterance: "Find restaurants in this area",
    observe: (page) =>
      expect(page.locator("#restaurant-results")).toBeVisible({
        timeout: 15_000,
      }),
  },
  {
    family: "plan",
    capabilityId: "plan.open",
    argumentsValue: {},
    utterance: "Open my plan",
    observe: (page) => expect(page.locator("#plan-builder")).toBeVisible(),
  },
  {
    family: "navigation",
    capabilityId: "navigation.closeassistant",
    argumentsValue: {},
    utterance: "Close the assistant",
    observe: (page) =>
      expect(page.locator('[data-testid="assistant-panel"]')).toBeHidden(),
  },
];

async function installVoiceHarness(page) {
  await page.addInitScript((snapshot) => {
    globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
    localStorage.setItem("amble.voice-disclosure.v1", "accepted");
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
  }, eventSnapshot);
  await page.route("**/api/restaurants?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1.0",
        status: "success",
        fetchedAt: "2026-07-18T12:00:00.000Z",
        restaurants: [restaurant],
      }),
    }),
  );
  await page.route("**/api/voice/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "voice-action-session",
          protocolVersion: "1.1",
          streamPath: "/api/voice/sessions/voice-action-session/stream",
          limits: {
            maxResponseStagesPerTurn: 3,
            responseTimeoutSeconds: 30,
          },
        },
      }),
    }),
  );

  let sendToBrowser = null;
  let revision = -1;
  let availableCapabilityIds = [];
  const browserMessages = [];
  const proposals = new Map();
  await page.routeWebSocket(
    "**/api/voice/sessions/voice-action-session/stream",
    (socket) => {
      sendToBrowser = (message) => socket.send(JSON.stringify(message));
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        browserMessages.push(message);
        if (message.type === "context.update") {
          revision = message.context.revision;
          availableCapabilityIds = message.context.availableCapabilityIds || [];
          return;
        }
        if (message.type !== "capability.result") return;
        const proposal = proposals.get(message.callId);
        if (!proposal) return;
        proposals.delete(message.callId);
        revision = Math.max(revision, message.result.contextRevision);
        sendToBrowser({
          type: "capability.completed",
          callId: message.callId,
          capabilityId: message.capabilityId,
          kind: message.kind,
          result: message.result,
        });
      });
      sendToBrowser({ type: "session.state", state: "listening" });
    },
  );
  const providerUrls = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });

  await page.goto("/#14/1.2858/103.8579/0/45");
  await page.locator('[data-testid="assistant-open"]').click();
  await expect
    .poll(() => revision, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);
  return {
    providerUrls,
    browserMessages,
    availableCapabilityIds: () => [...availableCapabilityIds],
    context: () =>
      [...browserMessages]
        .reverse()
        .find((message) => message.type === "context.update")?.context ?? null,
    revision: () => revision,
    propose(capabilityId, argumentsValue, callId, kind = "command") {
      const proposal = {
        type: "capability.proposed",
        callId,
        capabilityId,
        kind,
        arguments: argumentsValue,
        contextRevision: revision,
      };
      proposals.set(callId, proposal);
      sendToBrowser(proposal);
    },
    transcript(text, itemId) {
      sendToBrowser({
        type: "transcript.final",
        itemId,
        role: "user",
        modality: "audio",
        text,
      });
    },
  };
}

test("browser matrix covers every active capability family and excludes conditional families", () => {
  const inventoryFamilies = [
    ...new Set(activeInventoryIds.map((id) => id.split(".")[0])),
  ].sort();
  assertFamiliesEqual(
    journeys.map(({ family }) => family),
    inventoryFamilies,
  );
  expect(inventoryFamilies).not.toContain("saved");
  expect(inventoryFamilies).not.toContain("game");
});

for (const journey of journeys) {
  test(`protocol-1.1 executes the ${journey.family} capability through its shared gateway`, async ({
    page,
  }) => {
    const harness = await installVoiceHarness(page);
    const before = await journey.before?.(page);
    const callId = `${journey.family}-capability-001`;

    harness.transcript(journey.utterance, `${journey.family}-utterance-001`);
    harness.propose(
      journey.capabilityId,
      journey.argumentsValue,
      callId,
      journey.kind,
    );

    await journey.observe(page, before, harness, callId);
    await expect
      .poll(() =>
        harness.browserMessages.some(
          (message) =>
            message.type === "capability.result" &&
            message.callId === callId &&
            message.capabilityId === journey.capabilityId,
        ),
      )
      .toBe(true);
    expect(harness.providerUrls).toEqual([]);
  });
}

test("voice event sentences update the same authoritative composer state as direct entry", async ({
  page,
}) => {
  const harness = await installVoiceHarness(page);
  const latestContext = () =>
    [...harness.browserMessages]
      .reverse()
      .find((message) => message.type === "context.update")?.context;
  await expect
    .poll(
      () => latestContext()?.activeFilters?.eventComposerState?.catalogRevision,
    )
    .toBeTruthy();
  const revisionBeforeTranscript = latestContext().revision;
  const callId = "event-applyquery-001";

  harness.transcript(
    "free events this weekend",
    "event-sentence-utterance-001",
  );
  await expect
    .poll(() => latestContext()?.revision)
    .toBeGreaterThan(revisionBeforeTranscript);
  const context = latestContext();
  harness.propose(
    "event.applyquery",
    {
      text: "free events this weekend",
      mode: "replace",
      baseContextRevision: context.revision,
      catalogRevision: context.activeFilters.eventComposerState.catalogRevision,
    },
    callId,
  );

  await expect
    .poll(
      () =>
        harness.browserMessages.find(
          (message) =>
            message.type === "capability.result" && message.callId === callId,
        )?.result,
    )
    .toMatchObject({
      status: "completed",
      errorCode: null,
      data: {
        outcome: "applied",
        topEvents: expect.any(Array),
        canAddToPlan: expect.any(Boolean),
      },
    });
  const capabilityResult = harness.browserMessages.find(
    (message) =>
      message.type === "capability.result" && message.callId === callId,
  ).result;
  expect(capabilityResult.data.topEvents.length).toBeLessThanOrEqual(3);
  for (const event of capabilityResult.data.topEvents)
    expect(event).toEqual({
      eventId: expect.any(String),
      title: expect.any(String),
    });
  await expect
    .poll(
      () =>
        harness.browserMessages.find(
          (message) =>
            message.type === "capability.result" && message.callId === callId,
        )?.result?.contextRevision,
    )
    .toBeGreaterThanOrEqual(context.revision);
  harness.propose("navigation.closeassistant", {}, "event-close-assistant-001");
  await expect(page.locator('[data-testid="assistant-panel"]')).toBeHidden();
  await expect(
    page.locator('[data-filter-token-id="when:this-weekend"]'),
  ).toHaveText("This weekend");
  await expect(page.locator('[data-filter-token-id="price:free"]')).toHaveText(
    "Free",
  );
  await expect(page.locator(".landmark-event-search__popover")).toBeVisible();
  await expect(page.locator("#landmark-event-search-input")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(
      () =>
        latestContext()?.activeFilters?.eventComposerState?.canonicalSentence,
    )
    .toBe("This weekend Free");

  const appliedContext = latestContext();
  harness.propose(
    "event.applyquery",
    {
      text: "Today",
      mode: "refine",
      baseContextRevision: context.revision,
      catalogRevision:
        appliedContext.activeFilters.eventComposerState.catalogRevision,
    },
    "event-stale-001",
  );
  await expect
    .poll(
      () =>
        harness.browserMessages.find(
          (message) =>
            message.type === "capability.result" &&
            message.callId === "event-stale-001",
        )?.result,
    )
    .toMatchObject({ status: "failed", errorCode: "stale_context" });
  expect(
    latestContext().activeFilters.eventComposerState.canonicalSentence,
  ).toBe("This weekend Free");

  harness.propose(
    "event.applyquery",
    {
      text: "Today this weekend",
      mode: "refine",
      baseContextRevision: appliedContext.revision,
      catalogRevision:
        appliedContext.activeFilters.eventComposerState.catalogRevision,
    },
    "event-clarification-001",
  );
  await expect
    .poll(
      () =>
        harness.browserMessages.find(
          (message) =>
            message.type === "capability.result" &&
            message.callId === "event-clarification-001",
        )?.result,
    )
    .toMatchObject({ status: "failed", errorCode: "result_invalid" });
  expect(
    latestContext().activeFilters.eventComposerState.canonicalSentence,
  ).toBe("This weekend Free");
});

test("a named restaurant follow-up uses the exact current target once", async ({
  page,
}) => {
  const harness = await installVoiceHarness(page);
  harness.propose(
    "restaurant.searchviewport",
    {},
    "restaurant-follow-up-search",
  );
  await expect
    .poll(() =>
      harness.browserMessages.find(
        (message) =>
          message.type === "capability.result" &&
          message.callId === "restaurant-follow-up-search",
      ),
    )
    .toBeTruthy();
  const candidate = harness
    .context()
    ?.visibleTargets?.find(({ type }) => type === "restaurant");
  expect(candidate).toMatchObject({
    targetId: expect.any(String),
    label: "Fixture Kitchen",
  });

  harness.transcript("the first one", "restaurant-follow-up-utterance");
  harness.propose(
    "restaurant.selectresult",
    { restaurantId: candidate.targetId },
    "restaurant-follow-up-select",
  );
  await expect
    .poll(
      () =>
        harness.browserMessages.filter(
          (message) =>
            message.type === "capability.result" &&
            message.callId === "restaurant-follow-up-select",
        ).length,
    )
    .toBe(1);
  await expect(page.locator("#restaurant-detail")).toBeVisible();
});

test("empty conditional content and browser-owned lifecycle controls are never advertised", async ({
  page,
}) => {
  const harness = await installVoiceHarness(page);
  const capabilityIds = harness.availableCapabilityIds();

  expect(
    capabilityIds.filter(
      (id) => id.startsWith("saved.") || id.startsWith("game."),
    ),
  ).toEqual([]);
  expect(capabilityIds.filter((id) => id.startsWith("session."))).toEqual([]);
  const browserOwnedControls = page.locator('[data-control-owner="browser"]');
  await expect(browserOwnedControls).not.toHaveCount(0);
  for (const control of await browserOwnedControls.all())
    await expect(control).not.toHaveAttribute("data-capability-id", /.+/);
});

test("direct and conversational zoom use the same observable map executor", async ({
  browser,
  page,
}) => {
  await installVoiceHarness(page);
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  const initial = await page.evaluate(() => window._map.getZoom());

  if (!(await zoomIn.isVisible())) {
    await expect(zoomIn).toBeHidden();
    return;
  }

  await zoomIn.click();
  await expect
    .poll(() => page.evaluate(() => window._map.getZoom()))
    .toBeCloseTo(initial + 1, 5);
  const direct = await page.evaluate(() => window._map.getZoom());
  expect(direct).toBeGreaterThan(initial);

  const conversationalPage = await browser.newPage();
  try {
    const harness = await installVoiceHarness(conversationalPage);
    const conversationalInitial = await conversationalPage.evaluate(() =>
      window._map.getZoom(),
    );
    harness.propose("map.zoomin", {}, "map-parity-capability-001");
    await expect
      .poll(() =>
        harness.browserMessages.find(
          (message) =>
            message.type === "capability.result" &&
            message.callId === "map-parity-capability-001",
        ),
      )
      .toMatchObject({ result: { status: "completed" } });
    await expect
      .poll(() => conversationalPage.evaluate(() => window._map.getZoom()))
      .toBeCloseTo(conversationalInitial + 1, 5);
    const conversational = await conversationalPage.evaluate(() =>
      window._map.getZoom(),
    );

    expect(conversational - conversationalInitial).toBeCloseTo(
      direct - initial,
      5,
    );
  } finally {
    await conversationalPage.close();
  }
});

function assertFamiliesEqual(actual, expected) {
  expect([...new Set(actual)].sort()).toEqual(expected);
}
