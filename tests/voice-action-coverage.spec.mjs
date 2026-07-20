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
const inventoryActionIds = [
  ...inventoryText.matchAll(/^\|\s*`([a-z][a-z0-9]*\.[a-z][a-z0-9]*)`\s*\|/gm),
].map((match) => match[1]);

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
    family: "map",
    actionId: "map.zoomin",
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
    actionId: "tour.start",
    argumentsValue: {},
    utterance: "Show me the feature tour",
    observe: (page) => expect(page.locator("#feature-tour")).toBeVisible(),
  },
  {
    family: "event",
    actionId: "event.search",
    argumentsValue: { query: "Jazz" },
    utterance: "Search events for jazz",
    observe: (page) =>
      expect(page.locator("#landmark-event-search-input")).toHaveValue("Jazz"),
  },
  {
    family: "restaurant",
    actionId: "restaurant.searchviewport",
    argumentsValue: {},
    utterance: "Find restaurants in this area",
    observe: (page) =>
      expect(page.locator("#restaurant-results")).toBeVisible(),
  },
  {
    family: "plan",
    actionId: "plan.open",
    argumentsValue: {},
    utterance: "Open my plan",
    observe: (page) => expect(page.locator("#plan-builder")).toBeVisible(),
  },
  {
    family: "saved",
    actionId: "saved.open",
    argumentsValue: {},
    utterance: "Show my saved places",
    observe: (page) =>
      expect(page.locator('[data-testid="saved-content-panel"]')).toBeVisible(),
  },
  {
    family: "game",
    actionId: "game.open",
    argumentsValue: { gameId: "game-fixture-001" },
    utterance: "Open my current game",
    observe: (page) =>
      expect(page.locator('[data-testid="game-panel"]')).toBeVisible(),
  },
  {
    family: "navigation",
    actionId: "navigation.closeassistant",
    argumentsValue: {},
    utterance: "Close the assistant",
    observe: (page) =>
      expect(page.locator('[data-testid="assistant-panel"]')).toBeHidden(),
  },
];

async function installVoiceHarness(page) {
  await page.addInitScript(
    ({ snapshot, savedItems, games }) => {
      globalThis.__EVENT_PIPELINE_SNAPSHOT__ = snapshot;
      globalThis.__ASSISTANT_SAVED_ITEMS__ = savedItems;
      globalThis.__ASSISTANT_PUBLIC_GAMES__ = games;
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
    },
    {
      snapshot: eventSnapshot,
      savedItems: [
        {
          id: "saved-fixture-001",
          title: "Saved waterfront walk",
          areaId: "ura-subzone:marina-south",
        },
      ],
      games: [
        {
          id: "game-fixture-001",
          title: "Fixture city hunt",
          status: "paused",
        },
      ],
    },
  );
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
          protocolVersion: "1.0",
          streamPath: "/api/voice/sessions/voice-action-session/stream",
          expiresAt: "2026-07-18T12:05:00.000Z",
          limits: {
            maxSessionSeconds: 300,
            idleSeconds: 60,
            maxResponses: 6,
          },
        },
      }),
    }),
  );

  let sendToBrowser = null;
  const browserMessages = [];
  await page.routeWebSocket(
    "**/api/voice/sessions/voice-action-session/stream",
    (socket) => {
      sendToBrowser = (message) => socket.send(JSON.stringify(message));
      socket.onMessage((message) => {
        try {
          browserMessages.push(JSON.parse(String(message)));
        } catch {}
      });
      sendToBrowser({ type: "session.state", state: "listening" });
    },
  );
  const providerUrls = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });

  await page.goto("/?autoStart#14/1.2858/103.8579/0/45");
  await page.locator('[data-testid="assistant-open"]').click();
  await page.locator('[data-testid="assistant-disclosure-accept"]').click();
  await expect.poll(() => Boolean(sendToBrowser)).toBe(true);
  return { providerUrls, sendToBrowser, browserMessages };
}

test("mocked browser matrix represents every reviewed public action family", () => {
  const inventoryFamilies = [
    ...new Set(inventoryActionIds.map((actionId) => actionId.split(".")[0])),
  ].sort();
  assertFamiliesEqual(
    journeys.map(({ family }) => family),
    inventoryFamilies,
  );
});

for (const journey of journeys) {
  test(`mocked voice executes the ${journey.family} action family through the application gateway`, async ({
    page,
  }) => {
    const harness = await installVoiceHarness(page);
    const before = await journey.before?.(page);

    harness.sendToBrowser({
      type: "transcript.final",
      itemId: `${journey.family}-utterance-001`,
      role: "user",
      modality: "audio",
      text: journey.utterance,
    });
    harness.sendToBrowser({
      type: "action.proposed",
      callId: `${journey.family}-call-001`,
      actionId: journey.actionId,
      canonicalArguments: journey.argumentsValue,
      contextRevision: 1,
    });

    await journey.observe(page, before);
    expect(harness.providerUrls).toEqual([]);
  });
}

test("consequential voice actions wait for a separate user confirmation", async ({
  page,
}) => {
  const harness = await installVoiceHarness(page);
  harness.sendToBrowser({
    type: "action.proposed",
    callId: "saved-open-call",
    actionId: "saved.openitem",
    canonicalArguments: { itemId: "saved-fixture-001" },
    contextRevision: 1,
  });
  const savedItem = page.locator('[data-saved-item-id="saved-fixture-001"]');
  await expect(savedItem).toHaveCount(1);
  await expect(savedItem).toHaveAttribute("aria-current", "true");

  harness.sendToBrowser({
    type: "action.proposed",
    callId: "saved-delete-call",
    actionId: "saved.deleteitem",
    canonicalArguments: { itemId: "saved-fixture-001" },
    contextRevision: 1,
    effectSummary: "Delete Saved waterfront walk from saved content.",
  });

  await expect(
    page.locator('[data-testid="assistant-confirmation"]'),
  ).toBeVisible();
  await expect(savedItem).toHaveCount(1);
  await page.locator('[data-testid="assistant-confirmation-accept"]').click();
  await expect(savedItem).toHaveCount(0);
  await expect
    .poll(() =>
      harness.browserMessages.some(
        (message) =>
          message.type === "action.result" &&
          message.callId === "saved-delete-call" &&
          message.ok === true,
      ),
    )
    .toBe(true);
});

function assertFamiliesEqual(actual, expected) {
  expect([...new Set(actual)].sort()).toEqual(expected);
}
