import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
      pois: [],
      landmarks: [],
      backgroundTilesetUrl: "tests/fixtures/empty-tileset.json",
      poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
    };
  });
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );
const vagueDiscovery = fixture("vague-discovery.json");
const approvedCandidates = fixture("approved-candidates.json");

const selectors = {
  open: '[data-testid="assistant-open"]',
  acceptDisclosure: '[data-testid="assistant-disclosure-accept"]',
  panel: '[data-testid="assistant-panel"]',
  transcriptUser: '[data-testid="assistant-transcript-user"]',
  areaCard: '[data-testid="assistant-area-card"]',
  clarification: '[data-testid="assistant-clarification"]',
  empty: '[data-testid="assistant-empty"]',
  error: '[data-testid="assistant-error"]',
  localFallback: '[data-testid="assistant-local-fallback"]',
};

function discoveryEvent(result, revision = 1) {
  return {
    type: "action.proposed",
    callId: `discovery-call-${revision}`,
    actionId: "discovery.presentareas",
    canonicalArguments: { result },
    contextRevision: revision,
  };
}

async function installApprovedCandidates(page) {
  await page.addInitScript((candidates) => {
    globalThis.__ASSISTANT_APPROVED_CANDIDATES__ = candidates;
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
  }, approvedCandidates);
}

async function startVoice(page) {
  await page.locator(selectors.acceptDisclosure).click();
}

async function mockRealtime(page, { initialResult, refinementResult } = {}) {
  const requests = [];
  const providerUrls = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });
  await page.route("**/api/voice/sessions", async (route) => {
    requests.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "session-fixture-001",
          protocolVersion: "1.0",
          streamPath: "/api/voice/sessions/session-fixture-001/stream",
          expiresAt: "2026-07-18T12:05:00.000Z",
          limits: {
            maxSessionSeconds: 300,
            idleSeconds: 60,
            maxResponses: 6,
          },
        },
      }),
    });
  });
  await page.routeWebSocket(
    "**/api/voice/sessions/session-fixture-001/stream",
    (socket) => {
      socket.send(
        JSON.stringify({ type: "session.state", state: "listening" }),
      );
      if (initialResult) {
        socket.send(
          JSON.stringify({
            type: "transcript.final",
            itemId: "user-item-001",
            role: "user",
            modality: "audio",
            text: vagueDiscovery.input.utterance,
          }),
        );
        socket.send(JSON.stringify(discoveryEvent(initialResult)));
        socket.send(
          JSON.stringify({
            type: "assistant.text.done",
            itemId: "assistant-item-001",
            text: "I found two areas that fit a calm evening.",
          }),
        );
        if (refinementResult) {
          socket.send(
            JSON.stringify({
              type: "transcript.final",
              itemId: "user-item-002",
              role: "user",
              modality: "audio",
              text: "Make it livelier",
            }),
          );
          socket.send(JSON.stringify(discoveryEvent(refinementResult, 2)));
          socket.send(
            JSON.stringify({
              type: "assistant.text.done",
              itemId: "assistant-item-002",
              text: "I moved the livelier arts area to the top.",
            }),
          );
        }
      }
    },
  );
  return { requests, providerUrls };
}

async function openAssistant(page) {
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await page.locator(selectors.open).click();
  await expect(page.locator(selectors.panel)).toBeVisible();
}

test("vague voice discovery presents grounded areas and accepts voice refinement", async ({
  page,
}) => {
  const initial = structuredClone(vagueDiscovery.expectedResult);
  const refined = structuredClone(initial);
  refined.intentRevision = 2;
  refined.clarification = null;
  refined.areas = [
    { ...refined.areas[1], rank: 1, confidence: 0.88 },
    { ...refined.areas[0], rank: 2, confidence: 0.75 },
  ];
  await installApprovedCandidates(page);
  const relay = await mockRealtime(page, {
    initialResult: initial,
    refinementResult: refined,
  });
  await openAssistant(page);

  await startVoice(page);
  await expect(page.locator(selectors.transcriptUser)).toContainText(
    vagueDiscovery.input.utterance,
  );
  await expect(page.locator(selectors.areaCard)).toHaveCount(2);
  await expect(page.locator(selectors.areaCard).first()).toContainText(
    /garden setting|waterfront views/i,
  );
  await expect(page.locator(selectors.areaCard).first()).toContainText(
    /crowd levels/i,
  );

  await expect(page.locator(selectors.transcriptUser)).toContainText(
    "Make it livelier",
  );
  await expect(page.locator(selectors.areaCard).first()).toHaveAttribute(
    "data-area-id",
    "ura-subzone:city-hall",
  );
  await expect(page.locator(selectors.panel)).toContainText(
    /moved the livelier arts area to the top/i,
  );
  expect(relay.requests).toHaveLength(1);
  expect(relay.providerUrls).toEqual([]);
});

test("material ambiguity asks one focused clarification inside the voice flow", async ({
  page,
}) => {
  const result = structuredClone(vagueDiscovery.expectedResult);
  result.areas = [];
  await installApprovedCandidates(page);
  const relay = await mockRealtime(page, { initialResult: result });
  await openAssistant(page);

  await startVoice(page);
  const clarification = page.locator(selectors.clarification);
  await expect(clarification).toHaveCount(1);
  await expect(clarification).toContainText(result.clarification.question);
  await expect(
    clarification.getByRole("button", { name: "Garden walk" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="assistant-text-input"]'),
  ).toHaveCount(0);
  expect(relay.providerUrls).toEqual([]);
});

test("unsupported discovery returns an honest empty state instead of invented places", async ({
  page,
}) => {
  await installApprovedCandidates(page);
  const relay = await mockRealtime(page, {
    initialResult: { intentRevision: 1, areas: [], clarification: null },
  });
  await openAssistant(page);

  await startVoice(page);
  await expect(page.locator(selectors.empty)).toContainText(
    /no reliable match/i,
  );
  await expect(page.locator(selectors.empty)).toContainText(/try|refine/i);
  await expect(page.locator(selectors.areaCard)).toHaveCount(0);
  expect(relay.providerUrls).toEqual([]);
});

test("provider failure keeps the voice pill retryable without a text chatbot", async ({
  page,
}) => {
  await installApprovedCandidates(page);
  let sessionRequests = 0;
  const providerUrls = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });
  await page.route("**/api/voice/sessions", async (route) => {
    sessionRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "1.0",
        error: {
          code: "provider_unavailable",
          message: "Voice could not connect. Please try again.",
        },
      }),
    });
  });
  await openAssistant(page);

  await startVoice(page);
  await expect(page.locator(selectors.error)).toContainText(/try again/i);
  await expect(
    page.locator('[data-testid="assistant-text-input"]'),
  ).toHaveCount(0);
  expect(sessionRequests).toBe(1);
  expect(providerUrls).toEqual([]);
});
