import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readFixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );
const approvedCandidates = readFixture("approved-candidates.json");
const discovery = readFixture("vague-discovery.json").expectedResult;

const areaCard = (page, areaId) =>
  page.locator(`[data-testid="assistant-area-card"][data-area-id="${areaId}"]`);

async function installCandidates(page) {
  await page.addInitScript((fixture) => {
    globalThis.__ASSISTANT_APPROVED_CANDIDATES__ = fixture;
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

async function openLocalAreaResults(page) {
  await installCandidates(page);
  await page.route("**/api/voice/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "area-list-session",
          protocolVersion: "1.0",
          streamPath: "/api/voice/sessions/area-list-session/stream",
          expiresAt: "2026-07-18T12:05:00.000Z",
          limits: { maxSessionSeconds: 300, idleSeconds: 60, maxResponses: 6 },
        },
      }),
    }),
  );
  await page.routeWebSocket(
    "**/api/voice/sessions/area-list-session/stream",
    (socket) => {
      socket.send(JSON.stringify({ type: "session.state", state: "listening" }));
      socket.send(
        JSON.stringify({
          type: "transcript.final",
          itemId: "area-request-001",
          role: "user",
          modality: "audio",
          text: "A waterfront evening",
        }),
      );
      socket.send(
        JSON.stringify({
          type: "action.proposed",
          callId: "present-areas-list-001",
          actionId: "discovery.presentareas",
          canonicalArguments: { result: discovery },
          contextRevision: 1,
        }),
      );
    },
  );
  await page.goto("/?autoStart&emptyApprovedSnapshot#11/1.3521/103.8198/0/45");
  await page.locator('[data-testid="assistant-open"]').click();
  await page.locator('[data-testid="assistant-disclosure-accept"]').click();
  await expect(page.locator('[data-testid="assistant-area-card"]')).toHaveCount(
    2,
  );
}

async function expectAreaDrillDown(page, areaId, candidateIds) {
  await expect(page.locator("body")).toHaveAttribute(
    "data-selected-discovery-area",
    areaId,
  );
  await expect(areaCard(page, areaId)).toHaveAttribute("aria-current", "true");
  const detail = page.locator(
    `[data-testid="assistant-area-detail"][data-area-id="${areaId}"]`,
  );
  await expect(detail).toBeVisible();
  await expect(
    detail.locator('[data-testid="assistant-area-candidate"]'),
  ).toHaveCount(candidateIds.length);
  for (const candidateId of candidateIds)
    await expect(
      detail.locator(`[data-candidate-id="${candidateId}"]`),
    ).toBeVisible();
}

test("pointer selection drills from a recommended area into supported places", async ({
  page,
}) => {
  await openLocalAreaResults(page);
  const target = discovery.areas[0];

  await areaCard(page, target.areaId)
    .getByRole("button", { name: "Show options" })
    .click();

  await expectAreaDrillDown(page, target.areaId, target.candidateIds);
});

test.describe("touch area drill-down", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("touch selection focuses the area and reveals its contained places", async ({
    page,
  }) => {
    await openLocalAreaResults(page);
    const target = discovery.areas[1];

    await areaCard(page, target.areaId)
      .getByRole("button", { name: "Show options" })
      .tap();

    await expectAreaDrillDown(page, target.areaId, target.candidateIds);
  });
});

test("keyboard selection has the same observable drill-down state", async ({
  page,
}) => {
  await openLocalAreaResults(page);
  const target = discovery.areas[0];
  const button = areaCard(page, target.areaId).getByRole("button", {
    name: "Show options",
  });

  await button.focus();
  await expect(button).toBeFocused();
  await button.press("Enter");

  await expectAreaDrillDown(page, target.areaId, target.candidateIds);
});

test("mocked voice area selection uses the same drill-down path without a live provider", async ({
  page,
}) => {
  await installCandidates(page);
  const providerUrls = [];
  let sendToBrowser = null;
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });
  await page.route("**/api/voice/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "area-session-fixture",
          protocolVersion: "1.0",
          streamPath: "/api/voice/sessions/area-session-fixture/stream",
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
  await page.routeWebSocket(
    "**/api/voice/sessions/area-session-fixture/stream",
    (socket) => {
      sendToBrowser = (message) => socket.send(JSON.stringify(message));
      sendToBrowser({ type: "session.state", state: "listening" });
      sendToBrowser({
        type: "action.proposed",
        callId: "present-areas-001",
        actionId: "discovery.presentareas",
        canonicalArguments: { result: discovery },
        contextRevision: 1,
      });
    },
  );
  await page.goto("/?autoStart&emptyApprovedSnapshot#11/1.3521/103.8198/0/45");
  await page.locator('[data-testid="assistant-open"]').click();
  await page.locator('[data-testid="assistant-disclosure-accept"]').click();
  await expect.poll(() => Boolean(sendToBrowser)).toBe(true);
  await expect(page.locator('[data-testid="assistant-area-card"]')).toHaveCount(
    2,
  );

  const target = discovery.areas[0];
  sendToBrowser({
    type: "transcript.final",
    itemId: "voice-area-selection-001",
    role: "user",
    modality: "audio",
    text: "Show options in Marina South",
  });
  sendToBrowser({
    type: "action.proposed",
    callId: "open-area-001",
    actionId: "map.openarea",
    canonicalArguments: { areaId: target.areaId },
    contextRevision: 1,
  });

  await expectAreaDrillDown(page, target.areaId, target.candidateIds);
  expect(providerUrls).toEqual([]);
});
