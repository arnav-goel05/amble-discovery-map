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
  panel: '[data-testid="assistant-panel"]',
  transcriptUser: '[data-testid="assistant-transcript-user"]',
  areaCard: '[data-testid="assistant-area-card"]',
  clarification: '[data-testid="assistant-clarification"]',
  empty: '[data-testid="assistant-empty"]',
  error: '[data-testid="assistant-error"]',
  localFallback: '[data-testid="assistant-local-fallback"]',
};

function capabilityProposal(
  capabilityId,
  argumentsValue,
  { callId, kind = "query", revision = 1 } = {},
) {
  return {
    type: "capability.proposed",
    callId: callId ?? `${capabilityId}-call-${revision}`,
    capabilityId,
    kind,
    arguments: argumentsValue,
    contextRevision: revision,
  };
}

function capabilityCompleted(message) {
  return {
    type: "capability.completed",
    callId: message.callId,
    capabilityId: message.capabilityId,
    kind: message.kind,
    result: message.result,
  };
}

function discoveryProposal(result, revision = 1) {
  return capabilityProposal(
    "discovery.presentareas",
    { result },
    {
      callId: `discovery-call-${revision}`,
      kind: "command",
      revision,
    },
  );
}

async function installApprovedCandidates(page) {
  const catalogueCandidates = {
    ...structuredClone(approvedCandidates),
    candidates: approvedCandidates.candidates.map((candidate) => ({
      ...candidate,
      candidateType:
        candidate.candidateType === "venue" ? "area" : candidate.candidateType,
    })),
  };
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
  }, catalogueCandidates);
}

async function startVoice(page) {
  await expect(page.locator(selectors.open)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

async function mockRealtime(page, { initialResult, refinementResult } = {}) {
  const requests = [];
  const providerUrls = [];
  const browserMessages = [];
  const serverMessages = [];
  let sendRefinement = null;
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
          protocolVersion: "1.1",
          streamPath: "/api/voice/sessions/session-fixture-001/stream",
          limits: {
            maxResponseStagesPerTurn: 3,
            responseTimeoutSeconds: 30,
          },
        },
      }),
    });
  });
  await page.routeWebSocket(
    "**/api/voice/sessions/session-fixture-001/stream",
    (socket) => {
      const send = (message) => {
        serverMessages.push(structuredClone(message));
        socket.send(JSON.stringify(message));
      };
      const proposed = new Map();
      let phase = "initial";
      let revision = 0;
      let initialStarted = false;

      const propose = (message) => {
        proposed.set(message.callId, message);
        send(message);
      };
      const present = (result, nextRevision) => {
        propose(discoveryProposal(result, nextRevision));
      };
      const proposeSearch = (query, nextRevision) => {
        propose(
          capabilityProposal(
            "catalog.search",
            {
              query,
              types: [],
              limit: 20,
              cursor: null,
            },
            {
              callId: `catalog-search-${phase}-${nextRevision}`,
              revision: nextRevision,
            },
          ),
        );
      };

      socket.onMessage((raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        browserMessages.push(message);
        if (message.type === "context.update") {
          revision = Math.max(revision, message.context.revision);
          if (initialResult && !initialStarted) {
            initialStarted = true;
            send({
              type: "transcript.final",
              itemId: "user-item-001",
              role: "user",
              modality: "audio",
              text: vagueDiscovery.input.utterance,
            });
            proposeSearch("", revision);
          }
          return;
        }
        if (message.type !== "capability.result") return;
        const proposal = proposed.get(message.callId);
        if (!proposal) return;
        proposed.delete(message.callId);
        revision = Math.max(revision, message.result.contextRevision);
        send(capabilityCompleted(message));

        if (proposal.capabilityId === "catalog.search") {
          if (phase === "initial") {
            propose(
              capabilityProposal(
                "catalog.get",
                {
                  targetIds: ["candidate:esplanade-waterfront"],
                },
                {
                  callId: `catalog-get-initial-${revision}`,
                  revision,
                },
              ),
            );
          } else {
            present(refinementResult, revision);
          }
        } else if (proposal.capabilityId === "catalog.get") {
          present(initialResult, revision);
        } else if (
          proposal.capabilityId === "discovery.presentareas" &&
          phase === "initial"
        ) {
          send({
            type: "assistant.text.done",
            itemId: "assistant-item-001",
            text: "I found two areas that fit a calm evening.",
          });
        } else if (
          proposal.capabilityId === "discovery.presentareas" &&
          phase === "refine"
        ) {
          propose(
            capabilityProposal(
              "map.selectarea",
              { areaId: "ura-subzone:city-hall" },
              {
                callId: "select-refined-area",
                kind: "command",
                revision,
              },
            ),
          );
        } else if (proposal.capabilityId === "map.selectarea") {
          propose(
            capabilityProposal(
              "map.openarea",
              { areaId: "ura-subzone:city-hall" },
              {
                callId: "open-refined-area",
                kind: "command",
                revision,
              },
            ),
          );
        } else if (proposal.capabilityId === "map.openarea") {
          send({
            type: "assistant.text.done",
            itemId: "assistant-item-002",
            text: "I moved the livelier arts area to the top and opened it.",
          });
        }
      });

      socket.send(
        JSON.stringify({ type: "session.state", state: "listening" }),
      );
      if (refinementResult)
        sendRefinement = () => {
          phase = "refine";
          send({
            type: "transcript.final",
            itemId: "user-item-002",
            role: "user",
            modality: "audio",
            text: "Make it livelier",
          });
          proposeSearch("programme", revision);
        };
    },
  );
  return {
    requests,
    providerUrls,
    browserMessages,
    serverMessages,
    refine() {
      if (!sendRefinement) throw new Error("Refinement relay is not connected");
      sendRefinement();
    },
  };
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
  initial.mode = "recommendations";
  initial.clarification = null;
  initial.message = null;
  initial.areas[0].reasons = [
    {
      text: "The approved waterfront option is free and grounded in Marina South.",
      candidateIds: ["candidate:gardens-bay-walk"],
      attributeKeys: ["areaId", "price"],
    },
  ];
  initial.areas[1].reasons = [
    {
      text: "Approved civic and waterfront options are grounded in City Hall.",
      candidateIds: [
        "candidate:national-gallery",
        "candidate:esplanade-waterfront",
      ],
      attributeKeys: ["areaId", "price"],
    },
  ];
  const refined = {
    intentRevision: 2,
    mode: "recommendations",
    areas: [
      {
        ...structuredClone(initial.areas[1]),
        rank: 1,
        confidence: 0.88,
        reasons: [
          {
            text: "The approved waterfront programme is grounded in City Hall.",
            candidateIds: ["candidate:esplanade-waterfront"],
            attributeKeys: ["areaId", "price"],
          },
        ],
        candidateIds: ["candidate:esplanade-waterfront"],
      },
    ],
    clarification: null,
    message: null,
  };
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
    /waterfront option|Marina South/i,
  );
  await expect(page.locator(selectors.areaCard).first()).toContainText(
    /crowd levels/i,
  );
  await expect
    .poll(
      () =>
        relay.browserMessages.filter(
          (message) => message.type === "capability.result",
        ).length,
    )
    .toBeGreaterThanOrEqual(3);

  const initialSearch = relay.browserMessages.find(
    (message) =>
      message.type === "capability.result" &&
      message.capabilityId === "catalog.search",
  );
  expect(initialSearch).toMatchObject({
    kind: "query",
    result: {
      capabilityId: "catalog.search",
      kind: "query",
      status: "completed",
      changed: null,
      errorCode: null,
    },
  });
  expect(initialSearch).not.toHaveProperty("ok");
  expect(initialSearch.result.data.items.length).toBeGreaterThan(0);
  expect(initialSearch.result.data.items.length).toBeLessThanOrEqual(20);
  expect(initialSearch.result.data.total).toBeGreaterThanOrEqual(
    initialSearch.result.data.items.length,
  );
  for (const record of initialSearch.result.data.items) {
    expect(record.targetId).toMatch(/^[a-z][a-z0-9_-]*:.+/);
    expect(record.label).toEqual(expect.any(String));
  }

  const getResult = relay.browserMessages.find(
    (message) =>
      message.type === "capability.result" &&
      message.capabilityId === "catalog.get",
  );
  expect(getResult).toMatchObject({
    kind: "query",
    result: {
      capabilityId: "catalog.get",
      kind: "query",
      status: "completed",
      changed: null,
      errorCode: null,
    },
  });
  expect(getResult.result.data.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        targetId: "candidate:esplanade-waterfront",
      }),
    ]),
  );

  relay.refine();
  await expect(page.locator(selectors.transcriptUser)).toContainText(
    "Make it livelier",
  );
  await expect(page.locator(selectors.areaCard).first()).toHaveAttribute(
    "data-area-id",
    "ura-subzone:city-hall",
  );
  await expect(page.locator(selectors.panel)).toContainText(
    /moved the livelier arts area to the top and opened it/i,
  );
  await expect
    .poll(() =>
      relay.browserMessages
        .filter((message) => message.type === "capability.result")
        .map(({ capabilityId }) => capabilityId),
    )
    .toEqual(
      expect.arrayContaining([
        "catalog.search",
        "catalog.get",
        "discovery.presentareas",
        "map.selectarea",
        "map.openarea",
      ]),
    );

  const refinedSearch = relay.browserMessages
    .filter(
      (message) =>
        message.type === "capability.result" &&
        message.capabilityId === "catalog.search",
    )
    .at(-1);
  expect(
    refinedSearch.result.data.items.every(
      (record) =>
        typeof record.targetId === "string" &&
        typeof record.label === "string" &&
        !Object.hasOwn(record, "ok"),
    ),
  ).toBe(true);

  for (const capabilityId of ["map.selectarea", "map.openarea"]) {
    const message = relay.browserMessages.find(
      (candidate) =>
        candidate.type === "capability.result" &&
        candidate.capabilityId === capabilityId,
    );
    expect(message).toMatchObject({
      kind: "command",
      result: {
        capabilityId,
        kind: "command",
        status: "completed",
      },
    });
    expect(message.result.affectedTargetIds).toContain("ura-subzone:city-hall");
    expect(message).not.toHaveProperty("ok");
  }
  const completedIds = relay.serverMessages
    .filter((message) => message.type === "capability.completed")
    .map(({ capabilityId }) => capabilityId);
  expect(completedIds).toEqual(
    expect.arrayContaining([
      "catalog.search",
      "catalog.get",
      "discovery.presentareas",
      "map.selectarea",
      "map.openarea",
    ]),
  );
  expect(relay.requests).toHaveLength(1);
  expect(relay.providerUrls).toEqual([]);
});

test("material ambiguity asks one focused clarification inside the voice flow", async ({
  page,
}) => {
  const result = structuredClone(vagueDiscovery.expectedResult);
  result.areas = [];
  result.mode = "clarification";
  result.message = null;
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
  await expect(page.locator('[data-testid="assistant-text-form"]')).toHaveCount(
    0,
  );
  expect(relay.providerUrls).toEqual([]);
});

test("unsupported discovery returns an honest empty state instead of invented places", async ({
  page,
}) => {
  await installApprovedCandidates(page);
  const relay = await mockRealtime(page, {
    initialResult: {
      intentRevision: 1,
      mode: "no_match",
      areas: [],
      clarification: null,
      message:
        "No approved match was found. Try a broader time, area, or category.",
    },
  });
  await openAssistant(page);

  await startVoice(page);
  await expect(page.locator(selectors.empty)).toContainText(
    /no reliable match/i,
  );
  await expect(page.locator(selectors.empty)).toContainText(/try|refine/i);
  await expect(page.locator(selectors.areaCard)).toHaveCount(0);
  await expect(page.locator('[data-testid="assistant-text-form"]')).toHaveCount(
    0,
  );
  expect(relay.providerUrls).toEqual([]);
});

test("provider failure keeps the voice pill retryable without opening a text composer", async ({
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
  await expect(page.locator(selectors.error)).toHaveText(
    "Voice service is currently unavailable. Please try again later.",
  );
  await expect(page.locator('[data-testid="assistant-text-form"]')).toHaveCount(
    0,
  );
  await expect(page.locator("#landmark-event-search-input")).toBeEnabled();
  expect(sessionRequests).toBe(1);
  expect(providerUrls).toEqual([]);
});
