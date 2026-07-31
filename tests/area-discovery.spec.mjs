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
const discovery = {
  ...readFixture("vague-discovery.json").expectedResult,
  mode: "recommendations",
  clarification: null,
  message: null,
};
discovery.areas[0].reasons = [
  {
    text: "The approved waterfront option is grounded in Marina South.",
    candidateIds: ["candidate:gardens-bay-walk"],
    attributeKeys: ["areaId", "price"],
  },
];
discovery.areas[1].reasons = [
  {
    text: "Approved civic and waterfront options are grounded in City Hall.",
    candidateIds: [
      "candidate:national-gallery",
      "candidate:esplanade-waterfront",
    ],
    attributeKeys: ["areaId", "price"],
  },
];

const areaCard = (page, areaId) =>
  page.locator(`[data-testid="assistant-area-card"][data-area-id="${areaId}"]`);

async function installCandidates(page) {
  const catalogueCandidates = {
    ...structuredClone(approvedCandidates),
    candidates: approvedCandidates.candidates.map((candidate) => ({
      ...candidate,
      candidateType:
        candidate.candidateType === "venue" ? "area" : candidate.candidateType,
    })),
  };
  await page.addInitScript((fixture) => {
    globalThis.__ASSISTANT_APPROVED_CANDIDATES__ = fixture;
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
  }, catalogueCandidates);
}

async function openLocalAreaResults(page) {
  await installCandidates(page);
  const browserMessages = [];
  const serverMessages = [];
  const proposals = new Map();
  let sendToBrowser = null;
  let revision = 0;
  let started = false;
  await page.route("**/api/voice/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "area-list-session",
          protocolVersion: "1.1",
          streamPath: "/api/voice/sessions/area-list-session/stream",
          limits: {
            maxResponseStagesPerTurn: 3,
            responseTimeoutSeconds: 30,
          },
        },
      }),
    }),
  );
  await page.routeWebSocket(
    "**/api/voice/sessions/area-list-session/stream",
    (socket) => {
      sendToBrowser = (message) => {
        serverMessages.push(structuredClone(message));
        socket.send(JSON.stringify(message));
      };
      const propose = (
        capabilityId,
        argumentsValue,
        { callId, kind = "command", contextRevision = revision } = {},
      ) => {
        const proposal = {
          type: "capability.proposed",
          callId,
          capabilityId,
          kind,
          arguments: argumentsValue,
          contextRevision,
        };
        proposals.set(callId, proposal);
        sendToBrowser(proposal);
        return callId;
      };
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        browserMessages.push(message);
        if (message.type === "context.update") {
          revision = Math.max(revision, message.context.revision);
          if (!started) {
            started = true;
            sendToBrowser({
              type: "transcript.final",
              itemId: "area-request-001",
              role: "user",
              modality: "audio",
              text: "A waterfront evening",
            });
            propose(
              "catalog.search",
              { query: "", types: [], limit: 20, cursor: null },
              {
                callId: "area-catalog-search-001",
                kind: "query",
              },
            );
          }
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
        if (message.capabilityId === "catalog.search")
          propose(
            "discovery.presentareas",
            { result: discovery },
            {
              callId: "present-areas-list-001",
              contextRevision: revision,
            },
          );
      });
      sendToBrowser({ type: "session.state", state: "listening" });
    },
  );
  await page.goto("/?autoStart&emptyApprovedSnapshot#11/1.3521/103.8198/0/45");
  await page.locator('[data-testid="assistant-open"]').click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-map-loaded",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-testid="assistant-area-card"]')).toHaveCount(
    2,
    { timeout: 15_000 },
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-tileset-loaded",
    "true",
    { timeout: 20_000 },
  );
  await expect
    .poll(
      () =>
        browserMessages.some(
          (message) =>
            message.type === "capability.result" &&
            message.capabilityId === "discovery.presentareas",
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  return {
    browserMessages,
    serverMessages,
    currentRevision: () => revision,
    propose(
      capabilityId,
      argumentsValue,
      { callId, kind = "command", contextRevision = revision } = {},
    ) {
      if (!sendToBrowser) throw new Error("Area relay is not connected");
      const proposal = {
        type: "capability.proposed",
        callId,
        capabilityId,
        kind,
        arguments: argumentsValue,
        contextRevision,
      };
      proposals.set(callId, proposal);
      sendToBrowser(proposal);
      return callId;
    },
    sendAssistantText(text, itemId = "assistant-area-clarification") {
      sendToBrowser({
        type: "assistant.text.done",
        itemId,
        text,
      });
    },
    sendTranscript(text, itemId = "voice-area-selection-001") {
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

async function selectedAreaState(page) {
  return page.evaluate(() => ({
    selectedAreaId: document.body.dataset.selectedDiscoveryArea,
    currentAreaIds: [
      ...document.querySelectorAll(
        '[data-testid="assistant-area-card"][aria-current="true"]',
      ),
    ].map((element) => element.dataset.areaId),
    detailAreaId:
      document.querySelector('[data-testid="assistant-area-detail"]')?.dataset
        .areaId ?? null,
    detailCandidateIds: [
      ...document.querySelectorAll('[data-testid="assistant-area-candidate"]'),
    ].map((element) => element.dataset.candidateId),
  }));
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
  const providerUrls = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url()))
      providerUrls.push(request.url());
  });
  const harness = await openLocalAreaResults(page);

  const target = discovery.areas[0];
  harness.sendTranscript("Show options in Marina South");
  harness.propose(
    "map.openarea",
    { areaId: target.areaId },
    {
      callId: "open-area-001",
    },
  );

  await expectAreaDrillDown(page, target.areaId, target.candidateIds);
  expect(providerUrls).toEqual([]);
});

test("direct and protocol-1.1 voice selection produce identical selected and highlighted state", async ({
  page,
}) => {
  const harness = await openLocalAreaResults(page);
  const target = discovery.areas[0];
  const alternate = discovery.areas[1];

  await areaCard(page, target.areaId)
    .getByRole("button", { name: "Show options" })
    .click();
  const directState = await selectedAreaState(page);

  await areaCard(page, alternate.areaId)
    .getByRole("button", { name: "Show options" })
    .click();
  await expectAreaDrillDown(page, alternate.areaId, alternate.candidateIds);

  harness.sendTranscript("Select Marina South again", "voice-parity-001");
  harness.propose(
    "map.selectarea",
    { areaId: target.areaId },
    { callId: "select-area-parity-001" },
  );
  await expectAreaDrillDown(page, target.areaId, target.candidateIds);

  expect(await selectedAreaState(page)).toEqual(directState);
});

test("a stale area proposal is rejected and asks for clarification without changing highlight", async ({
  page,
}) => {
  const harness = await openLocalAreaResults(page);
  const current = discovery.areas[0];
  const staleTarget = discovery.areas[1];
  const staleRevision = harness.currentRevision();

  await areaCard(page, current.areaId)
    .getByRole("button", { name: "Show options" })
    .click();
  await expect
    .poll(() => harness.currentRevision())
    .toBeGreaterThan(staleRevision);
  const stateBeforeStaleProposal = await selectedAreaState(page);

  harness.sendTranscript(
    "Open that other area",
    "voice-stale-area-selection-001",
  );
  harness.propose(
    "map.openarea",
    { areaId: staleTarget.areaId },
    {
      callId: "open-stale-area-001",
      contextRevision: staleRevision,
    },
  );
  await expect
    .poll(() =>
      harness.browserMessages.find(
        (message) =>
          message.type === "capability.result" &&
          message.callId === "open-stale-area-001",
      ),
    )
    .toMatchObject({
      result: {
        status: "failed",
        changed: false,
        affectedTargetIds: [],
        errorCode: "stale_context",
      },
    });

  harness.sendAssistantText(
    "The map changed since that reference. Which visible area should I open?",
  );
  await expect(page.locator('[data-testid="assistant-panel"]')).toContainText(
    /map changed.*which visible area/i,
  );
  expect(await selectedAreaState(page)).toEqual(stateBeforeStaleProposal);
  await expect(areaCard(page, staleTarget.areaId)).not.toHaveAttribute(
    "aria-current",
    "true",
  );
});
