import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  RelayProtocolError,
  cleanupRelaySession,
  sanitizeProviderEvent,
  validateBrowserMessage,
  validateSessionAdmission,
} from "../scripts/lib/realtime-relay-protocol.mjs";
import {
  AMBLE_WELCOME_MESSAGE,
  EMPTY_TRANSCRIPT_RETRY_MESSAGE,
  OUT_OF_SCOPE_RESPONSE,
  PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
  buildAmbleSessionInstructions,
  buildFixedSpeechInstructions,
  buildVoiceIngressResponseInstructions,
  capabilityResultDialogue,
  capabilityResultSpeech,
  canonicalizeVoiceIngress,
  createPendingDialogue,
  createRealtimeRelay,
  describeAvailableCapabilities,
  interpretPendingDialogue,
  narrowPendingDialogueChoices,
  selectVoiceEventQueryMode,
  validatePendingDialogueResolutionOutcome,
  validateDiscoveryToolArguments,
} from "../cloudflare/realtime-relay.mjs";
import { pendingDialogueChoiceSpeech } from "../scripts/lib/pending-dialogue.mjs";
import { VOICE_SERVICE_UNAVAILABLE_MESSAGE } from "../activity-scenes/assistant/realtime-relay-client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  createLocalRelayOptions,
} = require("../scripts/realtime-voice-api-plugin.cjs");
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );

const admission = (overrides = {}) => ({
  requestUrl: "https://amble.example/api/voice/sessions",
  origin: "https://amble.example",
  contentType: "application/json",
  bodyBytes: 128,
  body: {
    protocolVersion: "1.1",
    disclosureAccepted: true,
    capabilities: { audioInput: true, audioOutput: true, text: true },
  },
  environmentEnabled: true,
  runtimeEnabled: true,
  providerPolicyValid: true,
  rateCardValid: true,
  reservationAvailable: true,
  rateLimited: false,
  ...overrides,
});

const throwsCode = (callback, code) =>
  assert.throws(
    callback,
    (error) => error instanceof RelayProtocolError && error.code === code,
  );

const flushRelay = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test("voice ingress canonicalizes only documented lossless provider variations", () => {
  const selection = { label: "Today", evidence: "today" };
  assert.deepEqual(
    canonicalizeVoiceIngress({
      domain: "event",
      eventQuery: {
        what: [],
        when: [selection],
        where: [],
        price: null,
      },
      residualQuery: "",
      unresolved: [],
    }),
    {
      domain: "event",
      eventQuery: {
        what: [],
        when: selection,
        where: null,
        price: null,
        residualQuery: "",
        unresolved: [],
      },
    },
  );
  assert.deepEqual(
    canonicalizeVoiceIngress({
      domain: "other",
      eventQuery: { what: [], residualQuery: "" },
      what: null,
      when: null,
      where: null,
      price: null,
      residualQuery: "MRT lines",
      unresolved: [],
    }),
    {
      domain: "other",
      eventQuery: null,
    },
  );
  assert.deepEqual(
    canonicalizeVoiceIngress({ domain: "other", eventQuery: null }),
    { domain: "other", eventQuery: null },
  );
  assert.deepEqual(
    canonicalizeVoiceIngress({
      domain: "event",
      eventQuery: {
        what: [],
        when: null,
        where: { label: "Near me", evidence: "nearby" },
        price: null,
      },
      residualQuery: "Italian restaurants",
      unresolved: ["what"],
      eventWhere: { label: "Near me", evidence: "nearby" },
    }),
    {
      domain: "event",
      eventQuery: {
        what: [],
        when: null,
        where: { label: "Near me", evidence: "nearby" },
        price: null,
        residualQuery: "Italian restaurants",
        unresolved: ["what"],
      },
    },
  );
});

test("voice ingress rejects semantic, cardinality, and unknown-field changes", () => {
  const base = {
    domain: "event",
    eventQuery: {
      what: [],
      when: null,
      where: null,
      price: null,
      residualQuery: "",
      unresolved: [],
    },
  };
  assert.equal(
    canonicalizeVoiceIngress({ ...base, imagined: "accepted" }),
    null,
  );
  assert.equal(
    canonicalizeVoiceIngress({
      ...base,
      eventQuery: {
        ...base.eventQuery,
        when: [
          { label: "Today", evidence: "today" },
          { label: "This weekend", evidence: "this weekend" },
        ],
      },
    }),
    null,
  );
  assert.equal(
    canonicalizeVoiceIngress({
      ...base,
      residualQuery: "different",
    }),
    null,
  );
  assert.equal(
    canonicalizeVoiceIngress({
      ...base,
      eventWhere: { label: "Near me", evidence: "nearby" },
      where: { label: "Marina Bay", evidence: "Marina Bay" },
    }),
    null,
  );
});

test("malformed event facets are discarded without affecting transcript ownership", () => {
  assert.deepEqual(
    canonicalizeVoiceIngress({
      domain: "event",
      eventQuery: {
        what: [{ label: "Workshops", evidence: "" }],
      },
      unresolved: ["what"],
    }),
    {
      domain: "event",
      eventQuery: null,
    },
  );
});

test("classification never accepts a model-supplied utterance", () => {
  assert.equal(
    canonicalizeVoiceIngress({
      utterance: "football match yesterday",
      domain: "event",
      eventQuery: {
        what: [],
        when: { label: "Choose dates", evidence: "yesterday" },
        where: null,
        price: null,
      },
      residualQuery: "football match yesterday",
      unresolved: ["what", "when"],
    }),
    null,
  );
});

test("native event mode refines only explicit follow-ups against existing state", () => {
  const existing = {
    filterTokens: [{ optionId: "what:exhibitions" }],
    residualQuery: "",
  };
  assert.equal(
    selectVoiceEventQueryMode("Make those free this weekend", existing),
    "refine",
  );
  assert.equal(
    selectVoiceEventQueryMode("Find exhibitions this weekend", existing),
    "replace",
  );
  assert.equal(
    selectVoiceEventQueryMode("Make those free", {
      filterTokens: [],
      residualQuery: "",
    }),
    "replace",
  );
});

test("authoritative capability outcomes produce bounded truthful speech", () => {
  const completed = (data = {}) => ({
    status: "completed",
    changed: true,
    data,
  });
  assert.equal(
    capabilityResultSpeech(
      "event.applyquery",
      {},
      {
        status: "completed",
        data: { outcome: "applied", resultCount: 11 },
      },
    ),
    "I found 11 matching events.",
  );
  assert.equal(
    capabilityResultSpeech(
      "event.applyquery",
      {},
      {
        status: "completed",
        data: {
          outcome: "applied",
          resultCount: 140,
          topEvents: [
            { eventId: "event:brunch", title: "100% Latin Rooftop Brunch" },
            {
              eventId: "event:ballet",
              title: "Singapore Ballet Masterpieces",
            },
            { eventId: "event:gallery", title: "When Art Meets Nature" },
          ],
          canAddToPlan: true,
        },
      },
    ),
    "I found 140 matching events. Top options are 100% Latin Rooftop Brunch, Singapore Ballet Masterpieces, and When Art Meets Nature. Which would you like me to add to your plan: first, 100% Latin Rooftop Brunch; second, Singapore Ballet Masterpieces; or third, When Art Meets Nature?",
  );
  assert.equal(
    capabilityResultSpeech(
      "event.applyquery",
      {},
      completed({
        outcome: "applied",
        resultCount: 2,
        topEvents: [
          { eventId: "event:one", title: "Gallery Night" },
          { eventId: "event:two", title: "Sunset Jazz" },
        ],
        canAddToPlan: false,
      }),
    ),
    "I found 2 matching events. Top options are Gallery Night and Sunset Jazz.",
  );

  const cases = [
    [
      "restaurant.search",
      { query: "Italian restaurants nearby" },
      completed({
        state: {
          results: [{ restaurantId: "restaurant:one", label: "Pasta One" }],
          resultIds: ["restaurant:one"],
        },
      }),
      "I found restaurant matches for Italian restaurants nearby. Would you like me to open Pasta One?",
    ],
    [
      "restaurant.setcuisine",
      { cuisineId: "south-indian" },
      completed({ state: { resultIds: ["restaurant:one"] } }),
      "South Indian it is! I refreshed the restaurant results.",
    ],
    [
      "restaurant.selectresult",
      { restaurantId: "restaurant:one" },
      completed(),
      "Good pick—that restaurant is selected.",
    ],
    [
      "restaurant.addtoplan",
      { restaurantId: "restaurant:one" },
      completed(),
      "Delicious choice—that restaurant is in your plan!",
    ],
    ["map.zoomin", {}, completed(), "Zooming in—let's get a closer look."],
    ["map.zoomout", {}, completed(), "Zooming out—here's the bigger picture."],
    [
      "map.pan",
      { direction: "east", amount: "medium" },
      completed(),
      "Moving east—let's see what's over there.",
    ],
    ["map.rotate", { bearing: 45 }, completed(), "Map rotated to 45 degrees."],
    ["map.resetview", {}, completed(), "Back to the Singapore overview."],
    [
      "map.setlayervisibility",
      { layer: "mrtLines", visible: false },
      completed(),
      "I hid train lines.",
    ],
    [
      "map.selectarea",
      { areaId: "area:marina-bay" },
      completed(),
      "I highlighted that area on the map.",
    ],
    [
      "plan.open",
      {},
      completed({ state: { stops: [], addableTargetIds: ["event:one"] } }),
      "Your plan is open and ready. Shall we add one of the places you're viewing?",
    ],
    [
      "plan.settravelmode",
      { mode: "transit" },
      completed(),
      "Switched to transit. I updated the route.",
    ],
    [
      "plan.addstop",
      { targetId: "event:one" },
      completed({
        state: {
          stops: [
            {
              stopId: "stop:one",
              targetId: "event:one",
              label: "Gallery Night",
            },
          ],
        },
      }),
      "Nice—Gallery Night is in your plan!",
    ],
    ["tour.start", {}, completed(), "Let's take a quick tour!"],
    [
      "tour.next",
      {},
      completed({ state: { stepIndex: 2, stepCount: 7 } }),
      "On to tour step 3 of 7.",
    ],
    [
      "navigation.closeoverlay",
      {},
      completed(),
      "All closed. You're back on the map.",
    ],
    [
      "navigation.openexternal",
      { targetId: "event:one", linkKind: "official" },
      completed(),
      "I opened the approved external page.",
    ],
    [
      "map.zoomin",
      {},
      { status: "completed", changed: false, data: {} },
      "You're already set—nothing needed changing.",
    ],
    [
      "catalog.search",
      {},
      { status: "empty", changed: null, data: null },
      "I couldn't find a matching result. Nothing changed.",
    ],
    [
      "map.zoomin",
      {},
      { status: "unavailable", changed: false, data: null },
      "That action isn't available right now. Nothing changed.",
    ],
    [
      "map.zoomin",
      {},
      { status: "failed", changed: false, data: null },
      "That didn't go through. Nothing changed.",
    ],
    [
      "plan.openroute",
      {},
      { status: "confirmation_required", changed: false, data: null },
      "This action needs your confirmation. Review the exact effect in Amble when you're ready.",
    ],
  ];
  for (const [capabilityId, argumentsValue, result, expected] of cases)
    assert.equal(
      capabilityResultSpeech(capabilityId, argumentsValue, result),
      expected,
      capabilityId,
    );

  for (const [, , , expected] of cases) {
    assert.doesNotMatch(expected, /Done in Amble/);
    assert.ok((expected.match(/\?/g) ?? []).length <= 1);
  }
});

test("pending dialogue resolves identity-backed replies without time expiry", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-001",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
      {
        targetId: "event:two",
        label: "Sunset Jazz",
        arguments: { eventId: "event:two" },
      },
    ],
    contextRevision: 9,
    nowMs: 1_000,
  });

  assert.equal(
    interpretPendingDialogue(pending, "yes", {
      contextRevision: 9,
    }).status,
    "clarified",
  );
  assert.equal(
    interpretPendingDialogue(pending, "the second one", {
      contextRevision: 9,
    }).candidate.targetId,
    "event:two",
  );
  assert.equal(
    interpretPendingDialogue(pending, "Gallery Night", {
      contextRevision: 9,
    }).candidate.targetId,
    "event:one",
  );
  assert.equal(
    interpretPendingDialogue(pending, "no thanks", {
      contextRevision: 9,
    }).status,
    "rejected",
  );
  assert.equal(
    interpretPendingDialogue(pending, "first, but only if it's free", {
      contextRevision: 9,
    }).reason,
    "mixed_constraint",
  );
  assert.equal(
    interpretPendingDialogue(pending, "first", {
      contextRevision: 10,
    }).status,
    "stale",
  );
  assert.equal(
    interpretPendingDialogue(pending, "first", {
      contextRevision: 9,
      nowMs: Number.MAX_SAFE_INTEGER,
    }).candidate.targetId,
    "event:one",
  );
  assert.equal(
    interpretPendingDialogue(pending, "zoom in", {
      contextRevision: 9,
      nowMs: 2_000,
    }).status,
    "unrecognized",
  );
});

test("pending dialogue exposes a versioned closed resolution outcome", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-outcome-contract",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
    ],
    contextRevision: 3,
    nowMs: 5_000,
  });
  const outcomes = [
    interpretPendingDialogue(pending, "Gallery Night", { contextRevision: 3 }),
    interpretPendingDialogue(pending, "that one", { contextRevision: 3 }),
    interpretPendingDialogue(pending, "no thanks", { contextRevision: 3 }),
    interpretPendingDialogue(pending, "zoom in", { contextRevision: 3 }),
  ];
  for (const outcome of outcomes) {
    assert.equal(
      outcome.schemaVersion,
      PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
    );
    assert.deepEqual(validatePendingDialogueResolutionOutcome(outcome), {
      valid: true,
    });
  }
  assert.deepEqual(outcomes.at(-1), {
    schemaVersion: PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
    status: "unrecognized",
    answerLike: false,
  });
  assert.equal(
    validatePendingDialogueResolutionOutcome({ status: "unrelated" }).valid,
    false,
  );
});

test("pending dialogue keeps immutable original candidates while narrowing choices", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-narrow",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:reflect-time",
        label: "Reflect on Time",
        arguments: { eventId: "event:reflect-time" },
      },
      {
        targetId: "event:reflections-gallery",
        label: "Reflections at the Gallery",
        arguments: { eventId: "event:reflections-gallery" },
      },
      {
        targetId: "event:ballet",
        label: "Singapore Ballet",
        arguments: { eventId: "event:ballet" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });

  assert.deepEqual(pending.applicableCandidateIndexes, [0, 1, 2]);
  const narrowed = narrowPendingDialogueChoices(pending, [0, 1]);
  assert.notEqual(narrowed, pending);
  assert.deepEqual(narrowed.applicableCandidateIndexes, [0, 1]);
  assert.deepEqual(
    narrowed.candidates.map(({ targetId }) => targetId),
    ["event:reflect-time", "event:reflections-gallery", "event:ballet"],
  );
  assert.equal(Object.isFrozen(narrowed.applicableCandidateIndexes), true);
  assert.equal(narrowPendingDialogueChoices(pending, [1, 1, 9]), null);
});

test("a one-candidate clarification is grammatical and asks one question", () => {
  const speech = pendingDialogueChoiceSpeech(
    [{ label: "Gallery Night" }],
    "choose",
  );
  assert.equal(speech, "Would you like me to choose Gallery Night?");
  assert.equal((speech.match(/\?/g) ?? []).length, 1);
});

test("pending dialogue resolves exact and uniquely identifying title evidence", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-title",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:reflect",
        label: "Reflect on Time",
        arguments: { eventId: "event:reflect" },
      },
      {
        targetId: "event:ballet",
        label: "Singapore Ballet",
        arguments: { eventId: "event:ballet" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });

  for (const reply of [
    "Reflect on Time",
    "add Reflect on Time",
    "ADD, REFLECT ON TIME!",
    "Reflect",
    "please choose Singapore Ballet",
  ])
    assert.equal(
      interpretPendingDialogue(pending, reply, {
        contextRevision: 4,
      }).candidate.targetId,
      reply.toLowerCase().includes("ballet") ? "event:ballet" : "event:reflect",
      reply,
    );

  assert.equal(
    interpretPendingDialogue(pending, "the fourth one", {
      contextRevision: 4,
    }).reason,
    "ordinal_out_of_range",
  );
});

test("pending dialogue normalizes internal punctuation without hiding collisions", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-title-punctuation",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:pop-up-market",
        label: "Pop-Up Market",
        arguments: { eventId: "event:pop-up-market" },
      },
      {
        targetId: "event:kids-gallery",
        label: "Kids' Gallery",
        arguments: { eventId: "event:kids-gallery" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });
  assert.equal(
    interpretPendingDialogue(pending, "add Pop Up Market", {
      contextRevision: 4,
    }).candidate.targetId,
    "event:pop-up-market",
  );
  assert.equal(
    interpretPendingDialogue(pending, "add Kids Gallery", {
      contextRevision: 4,
    }).candidate.targetId,
    "event:kids-gallery",
  );

  const collision = createPendingDialogue({
    dialogueId: "dialogue-title-punctuation-collision",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:hyphenated",
        label: "Pop-Up Market",
        arguments: { eventId: "event:hyphenated" },
      },
      {
        targetId: "event:spaced",
        label: "Pop Up Market",
        arguments: { eventId: "event:spaced" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });
  assert.deepEqual(
    interpretPendingDialogue(collision, "Pop Up Market", {
      contextRevision: 4,
    }).candidateIndexes,
    [0, 1],
  );
});

test("single-candidate offers accept affirmatives but always clarify unbound pronouns", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-single",
    capabilityId: "restaurant.selectresult",
    candidates: [
      {
        targetId: "restaurant:one",
        label: "Pasta One",
        arguments: { restaurantId: "restaurant:one" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });
  for (const reply of ["yes", "yes please", "do it", "Pasta One"])
    assert.deepEqual(
      interpretPendingDialogue(pending, reply, {
        contextRevision: 4,
        nowMs: 6_000,
      }).candidate.arguments,
      { restaurantId: "restaurant:one" },
      reply,
    );
  for (const reply of ["that one", "this one", "it"])
    assert.deepEqual(
      interpretPendingDialogue(pending, reply, {
        contextRevision: 4,
      }),
      {
        schemaVersion: PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
        status: "clarified",
        reason: "ambiguous_pronoun",
      },
      reply,
    );
});

test("pending dialogue narrows ambiguous title fragments without fuzzy matching", () => {
  const pending = createPendingDialogue({
    dialogueId: "dialogue-fragments",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:reflect-time",
        label: "Reflect on Time",
        arguments: { eventId: "event:reflect-time" },
      },
      {
        targetId: "event:reflect-gallery",
        label: "Reflect at the Gallery",
        arguments: { eventId: "event:reflect-gallery" },
      },
      {
        targetId: "event:ballet",
        label: "Singapore Ballet",
        arguments: { eventId: "event:ballet" },
      },
    ],
    contextRevision: 4,
    nowMs: 5_000,
  });

  assert.deepEqual(
    interpretPendingDialogue(pending, "add Reflect", {
      contextRevision: 4,
    }),
    {
      schemaVersion: PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
      status: "clarified",
      reason: "multiple_name_matches",
      candidateIndexes: [0, 1],
    },
  );
  assert.equal(
    interpretPendingDialogue(pending, "add Reflct", {
      contextRevision: 4,
    }).status,
    "unrecognized",
  );

  const narrowed = narrowPendingDialogueChoices(pending, [0, 1]);
  assert.equal(
    interpretPendingDialogue(narrowed, "the second one", {
      contextRevision: 4,
    }).candidate.targetId,
    "event:reflect-gallery",
  );
});

test("dialogue projection binds explicit event, restaurant, and plan choices", () => {
  const eventDialogue = capabilityResultDialogue(
    "event.applyquery",
    {},
    {
      status: "completed",
      changed: true,
      data: {
        outcome: "applied",
        resultCount: 2,
        topEvents: [
          { eventId: "event:one", title: "Gallery Night" },
          { eventId: "event:two", title: "Sunset Jazz" },
        ],
        canAddToPlan: true,
      },
    },
    { dialogueId: "dialogue-events", contextRevision: 7, nowMs: 1_000 },
  );
  assert.match(
    eventDialogue.speech,
    /first, Gallery Night; or second, Sunset Jazz/,
  );
  assert.deepEqual(
    eventDialogue.pendingDialogue.candidates.map(({ targetId }) => targetId),
    ["event:one", "event:two"],
  );

  const restaurantDialogue = capabilityResultDialogue(
    "restaurant.search",
    { query: "Italian" },
    {
      status: "completed",
      changed: true,
      data: {
        state: {
          results: [{ restaurantId: "restaurant:one", label: "Pasta One" }],
          resultIds: ["restaurant:one"],
        },
      },
    },
    { dialogueId: "dialogue-restaurants", contextRevision: 8, nowMs: 1_000 },
  );
  assert.equal(
    restaurantDialogue.speech,
    "I found restaurant matches for Italian. Would you like me to open Pasta One?",
  );
  assert.equal(
    restaurantDialogue.pendingDialogue.capabilityId,
    "restaurant.selectresult",
  );

  const planDialogue = capabilityResultDialogue(
    "plan.open",
    {},
    {
      status: "completed",
      changed: true,
      data: {
        state: { stops: [], addableTargetIds: ["event:one"] },
      },
    },
    {
      dialogueId: "dialogue-plan",
      contextRevision: 9,
      nowMs: 1_000,
      interfaceContext: {
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        availableCapabilityIds: ["plan.addstop"],
      },
    },
  );
  assert.equal(
    planDialogue.speech,
    "Your plan is open and ready. Would you like me to add Gallery Night?",
  );
  assert.deepEqual(planDialogue.pendingDialogue.candidates[0].arguments, {
    targetId: "event:one",
  });
});

test("relay consumes a pending offer before proposing its exact stored target", async () => {
  const records = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        availableCapabilityIds: ["event.addtoplan"],
      },
    }),
  );
  harness.relay.sessions.get(sessionId).pendingDialogue = createPendingDialogue(
    {
      dialogueId: "dialogue-once",
      capabilityId: "event.addtoplan",
      candidates: [
        {
          targetId: "event:one",
          label: "Gallery Night",
          arguments: { eventId: "event:one" },
        },
      ],
      contextRevision: 7,
      nowMs: Date.parse("2026-07-26T10:00:00.000Z"),
    },
  );

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "text.submit", turnId: "turn-yes", text: "yes" }),
  );
  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.deepEqual(proposal.arguments, { eventId: "event:one" });
  assert.equal(proposal.capabilityId, "event.addtoplan");
  assert.equal(harness.relay.sessions.get(sessionId).pendingDialogue, null);
  assert.equal(
    records.some(
      ({ phase, eventCode }) =>
        phase === "pending_dialogue" && eventCode === "consumed",
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(records),
    /Gallery Night|event:one|\byes\b/i,
  );

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: proposal.callId,
      capabilityId: "event.addtoplan",
      kind: "command",
      result: {
        capabilityId: "event.addtoplan",
        kind: "command",
        status: "completed",
        changed: false,
        affectedTargetIds: [],
        contextRevision: 7,
        data: { actionId: "event.addtoplan", changed: false },
        errorCode: null,
      },
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-duplicate-yes",
      text: "yes",
    }),
  );
  assert.equal(
    harness.browserMessages.filter(({ type }) => type === "capability.proposed")
      .length,
    1,
  );
});

test("relay narrows ambiguous title choices and resolves the next ordinal", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [
          {
            targetId: "event:reflect-time",
            type: "event",
            label: "Reflect on Time",
          },
          {
            targetId: "event:reflect-gallery",
            type: "event",
            label: "Reflect at the Gallery",
          },
          { targetId: "event:ballet", type: "event", label: "Ballet" },
        ],
        availableCapabilityIds: ["event.addtoplan"],
      },
    }),
  );
  const session = harness.relay.sessions.get(sessionId);
  session.pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-ambiguous-title",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:reflect-time",
        label: "Reflect on Time",
        arguments: { eventId: "event:reflect-time" },
      },
      {
        targetId: "event:reflect-gallery",
        label: "Reflect at the Gallery",
        arguments: { eventId: "event:reflect-gallery" },
      },
      {
        targetId: "event:ballet",
        label: "Ballet",
        arguments: { eventId: "event:ballet" },
      },
    ],
    contextRevision: 7,
    nowMs: 5_000,
  });

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-ambiguous-title",
      text: "add Reflect",
    }),
  );
  assert.deepEqual(session.pendingDialogue.applicableCandidateIndexes, [0, 1]);
  const clarification = harness.providerMessages.findLast(
    ({ type }) => type === "response.create",
  ).response.instructions;
  assert.match(clarification, /Reflect on Time/);
  assert.match(clarification, /Reflect at the Gallery/);
  assert.doesNotMatch(clarification, /Ballet/);
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );

  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-narrowed-second",
      text: "the second one",
    }),
  );
  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.equal(proposal.capabilityId, "event.addtoplan");
  assert.deepEqual(proposal.arguments, { eventId: "event:reflect-gallery" });
  assert.equal(session.pendingDialogue, null);
});

test("relay retains pending state for an unrecognized selection-shaped reply", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 3,
        visibleTargets: [],
        activeOverlayId: "assistant",
        availableCapabilityIds: [
          "event.addtoplan",
          "navigation.enterexperience",
        ],
      },
    }),
  );
  const session = harness.relay.sessions.get(sessionId);
  session.pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-unrecognized-selection",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
      {
        targetId: "event:two",
        label: "Sunset Jazz",
        arguments: { eventId: "event:two" },
      },
    ],
    contextRevision: 3,
    nowMs: 5_000,
  });

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-unrecognized-selection",
      text: "add the interesting one",
    }),
  );
  assert.equal(
    session.pendingDialogue.dialogueId,
    "dialogue-unrecognized-selection",
  );
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
  assert.match(
    harness.providerMessages.findLast(({ type }) => type === "response.create")
      .response.instructions,
    /Gallery Night|Sunset Jazz/,
  );
});

test("pending dialogue supersedes only for a clear supported action", async () => {
  const createPendingHarness = async (dialogueId, activeOverlayId = null) => {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 5,
          visibleTargets: [],
          activeOverlayId,
          availableCapabilityIds: [
            "event.addtoplan",
            "restaurant.search",
            "map.zoomin",
            "navigation.enterexperience",
          ],
        },
      }),
    );
    harness.relay.sessions.get(sessionId).pendingDialogue =
      createPendingDialogue({
        dialogueId,
        capabilityId: "event.addtoplan",
        candidates: [
          {
            targetId: "event:one",
            label: "Gallery Night",
            arguments: { eventId: "event:one" },
          },
          {
            targetId: "event:two",
            label: "Sunset Jazz",
            arguments: { eventId: "event:two" },
          },
        ],
        contextRevision: 5,
        nowMs: 5_000,
      });
    return { harness, sessionId };
  };

  const ambiguous = await createPendingHarness(
    "dialogue-overlay-only",
    "assistant",
  );
  await ambiguous.harness.relay.handleBrowserMessage(
    ambiguous.sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-overlay-only",
      text: "something interesting",
    }),
  );
  assert.equal(
    ambiguous.harness.relay.sessions.get(ambiguous.sessionId).pendingDialogue
      .dialogueId,
    "dialogue-overlay-only",
  );
  assert.equal(
    ambiguous.harness.browserMessages.some(
      ({ type }) => type === "capability.proposed",
    ),
    false,
  );

  const mapAction = await createPendingHarness("dialogue-map-action");
  await mapAction.harness.relay.handleBrowserMessage(
    mapAction.sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-map-action",
      text: "zoom in",
    }),
  );
  assert.equal(
    mapAction.harness.relay.sessions.get(mapAction.sessionId).pendingDialogue,
    null,
  );
  assert.equal(
    mapAction.harness.relay.sessions.get(mapAction.sessionId)
      .pendingDeterministic.capabilityId,
    "map.zoomin",
  );

  const restaurantAction = await createPendingHarness(
    "dialogue-restaurant-action",
  );
  await restaurantAction.harness.relay.handleBrowserMessage(
    restaurantAction.sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-restaurant-action",
      text: "find a restaurant deal",
    }),
  );
  const restaurantSession = restaurantAction.harness.relay.sessions.get(
    restaurantAction.sessionId,
  );
  assert.equal(restaurantSession.pendingDialogue, null);
  assert.equal(restaurantSession.tools.length > 0, true);
});

test("validated event results create the offer consumed by the next turn", async () => {
  const records = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        activeOverlayId: "event-search",
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v7",
            contextRevision: 7,
          },
        },
        availableCapabilityIds: ["event.applyquery", "event.addtoplan"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-event-offer",
      text: "find free events this weekend",
    }),
  );
  assert.equal(
    harness.relay.sessions.get(sessionId).pendingDeterministic?.capabilityId,
    "event.applyquery",
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 8,
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        activeOverlayId: "event-search",
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v8",
            contextRevision: 8,
          },
        },
        availableCapabilityIds: ["event.applyquery", "event.addtoplan"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "deterministic.result",
      capabilityId: "event.applyquery",
      kind: "command",
      result: {
        capabilityId: "event.applyquery",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: ["event:one"],
        contextRevision: 8,
        data: {
          outcome: "applied",
          canonicalSentence: "This weekend Free",
          residualQuery: "",
          phrases: [],
          clarificationChoices: [],
          catalogRevision: "events:v8",
          resultCount: 1,
          topEvents: [{ eventId: "event:one", title: "Gallery Night" }],
          canAddToPlan: true,
        },
        errorCode: null,
      },
    }),
  );
  await flushRelay();
  const session = harness.relay.sessions.get(sessionId);
  assert.equal(session.pendingDialogue?.capabilityId, "event.addtoplan");
  assert.match(
    harness.providerMessages.findLast(({ type }) => type === "response.create")
      .response.instructions,
    /Would you like me to add Gallery Night to your plan\?/,
  );
  assert.equal(
    records.some(
      ({ phase, eventCode }) =>
        phase === "pending_dialogue" && eventCode === "created",
    ),
    true,
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-accept-event-offer",
      text: "yes please",
    }),
  );
  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.equal(typeof proposal.callId, "string");
  assert.equal(proposal.capabilityId, "event.addtoplan");
  assert.equal(proposal.kind, "command");
  assert.deepEqual(proposal.arguments, { eventId: "event:one" });
  assert.equal(proposal.contextRevision, 8);
});

test("stale offers clarify without mutation and consequential offers retain confirmation", async () => {
  const staleHarness = await createRelayHarness();
  const staleSessionId = staleHarness.admitted.data.sessionId;
  const staleSession = staleHarness.relay.sessions.get(staleSessionId);
  staleSession.pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-stale",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
    ],
    contextRevision: 7,
    nowMs: Date.parse("2026-07-26T10:00:00.000Z"),
  });
  await staleHarness.relay.handleBrowserMessage(
    staleSessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 8,
        visibleTargets: [],
        availableCapabilityIds: ["event.addtoplan"],
      },
    }),
  );
  await staleHarness.relay.handleBrowserMessage(
    staleSessionId,
    JSON.stringify({ type: "text.submit", turnId: "turn-stale", text: "yes" }),
  );
  assert.equal(
    staleHarness.browserMessages.some(
      ({ type }) => type === "capability.proposed",
    ),
    false,
  );
  assert.equal(staleSession.pendingDialogue, null);
  assert.match(
    staleHarness.providerMessages.findLast(
      ({ type }) => type === "response.create",
    ).response.instructions,
    /Those results changed/,
  );

  const confirmationHarness = await createRelayHarness();
  const confirmationSessionId = confirmationHarness.admitted.data.sessionId;
  await confirmationHarness.relay.handleBrowserMessage(
    confirmationSessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 3,
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        availableCapabilityIds: ["event.openreference"],
      },
    }),
  );
  confirmationHarness.relay.sessions.get(
    confirmationSessionId,
  ).pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-confirm",
    capabilityId: "event.openreference",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
    ],
    contextRevision: 3,
    nowMs: Date.parse("2026-07-26T10:00:00.000Z"),
  });
  await confirmationHarness.relay.handleBrowserMessage(
    confirmationSessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-confirm",
      text: "go ahead",
    }),
  );
  const consequentialProposal = confirmationHarness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  await confirmationHarness.relay.handleBrowserMessage(
    confirmationSessionId,
    JSON.stringify({
      type: "confirmation.pending",
      callId: consequentialProposal.callId,
      capabilityId: "event.openreference",
      confirmationId: "confirmation-follow-up",
      fingerprint: "sha256:confirmation-follow-up",
      targetId: "event:one",
      effectSummary: "Open the approved Gallery Night event page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    }),
  );
  assert.equal(
    confirmationHarness.browserMessages.at(-1).type,
    "confirmation.required",
  );
  assert.equal(
    confirmationHarness.relay.sessions.get(confirmationSessionId).pendingCalls
      .size,
    1,
  );
});

test("native ingress response instructions prohibit returning a transcript", () => {
  const instructions = buildVoiceIngressResponseInstructions();
  assert.match(
    instructions,
    /never return, reconstruct, or paraphrase a transcript/i,
  );
  assert.match(instructions, /Do not answer/i);
  assert.match(instructions, /exactly once/i);
  assert.match(instructions, /no spoken or written commentary/i);
});

function createSocket(messages, listeners = {}) {
  return {
    readyState: 1,
    accept() {},
    close() {},
    send(value) {
      messages.push(JSON.parse(value));
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
}

async function createRelayHarness({
  operationalLogger = () => {},
  contentDebugLogger = null,
  responseSetTimeout,
  responseClearTimeout,
  configurationSetTimeout,
  configurationClearTimeout,
  now = () => new Date("2026-07-26T10:00:00.000Z"),
  budgetRepository: budgetOverrides = {},
  autoAcknowledgeConfiguration = true,
} = {}) {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const providerMessages = [];
  const browserMessages = [];
  const providerListeners = {};
  const providerSocket = createSocket(providerMessages, providerListeners);
  const providerSend = providerSocket.send;
  providerSocket.send = (value) => {
    providerSend(value);
    const message = JSON.parse(value);
    if (autoAcknowledgeConfiguration && message.type === "session.update")
      queueMicrotask(() =>
        providerListeners.message?.({
          data: JSON.stringify({
            type: "session.updated",
            session: structuredClone(message.session),
          }),
        }),
      );
  };
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve() {},
      async settle() {},
      async hold() {},
      ...budgetOverrides,
    },
    providerConnector: async () => providerSocket,
    randomId: () => `relay-fixture-${++identity}`,
    hash: async () => "sha256:relay-fixture",
    now,
    openingGreeting: false,
    operationalLogger,
    ...(contentDebugLogger ? { contentDebugLogger } : {}),
    ...(responseSetTimeout ? { responseSetTimeout } : {}),
    ...(responseClearTimeout ? { responseClearTimeout } : {}),
    ...(configurationSetTimeout ? { configurationSetTimeout } : {}),
    ...(configurationClearTimeout ? { configurationClearTimeout } : {}),
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, createSocket(browserMessages));
  if (autoAcknowledgeConfiguration) await flushRelay();
  return {
    admitted,
    browserMessages,
    providerListeners,
    providerMessages,
    relay,
  };
}

async function emitFinalInputTranscript(
  harness,
  transcript,
  itemId = "input-item-001",
) {
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: itemId,
    }),
  });
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: itemId,
      transcript,
    }),
  });
  await flushRelay();
}

test("voice operational traces expose only allowlisted phase timing", async () => {
  const records = [];
  const scheduled = [];
  const cleared = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-sensitive",
      text: "secret transcript at 1.3001,103.8001",
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.created",
      response: { id: "provider-secret-id" },
    }),
  });
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.output_audio.delta",
      delta: "secret-audio-payload",
    }),
  });
  const completion = fixture("transcript-provider-events.json").events.find(
    (event) => event.type === "response.done",
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.done",
      api_key: "sk-secret-sentinel",
      response: { usage: completion.usage },
    }),
  });
  await flushRelay();

  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["response_requested", "response_created", "first_audio", "response_done"],
  );
  const fields = [
    "elapsedMs",
    "event",
    "eventCode",
    "occurredAt",
    "phase",
    "schemaVersion",
    "sessionIdHash",
    "sincePreviousPhaseMs",
    "terminalReason",
    "turnNumber",
  ].sort();
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), fields);
    assert.equal(record.event, "voice.phase");
    assert.equal(record.sessionIdHash, "sha256:relay-fixture");
    assert.equal(Number.isInteger(record.elapsedMs), true);
    assert.equal(Number.isInteger(record.sincePreviousPhaseMs), true);
  }
  assert.doesNotMatch(
    JSON.stringify(records),
    /secret transcript|1\.3001|103\.8001|provider-secret|secret-audio|sk-secret|turn-sensitive/i,
  );
  assert.equal(scheduled.length, 1);
  assert.equal(cleared.includes(scheduled[0]), true);
});

test("audio turns wait for the final transcript before routing", async () => {
  const records = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-audio" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-audio" }),
  );
  await flushRelay();

  assert.deepEqual(
    harness.providerMessages.slice(-2).map(({ type }) => type),
    ["session.update", "input_audio_buffer.commit"],
  );
  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed"],
  );
  harness.relay.stop(sessionId, "user");
});

test("native audio exposes no LLM classifier before transcription", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 4,
        visibleTargets: [],
        activeOverlayId: "events",
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v4",
            contextRevision: 4,
          },
        },
        eventFacetCatalog: {
          catalogRevision: "events:v9",
          what: ["Exhibitions"],
          when: ["Today"],
          where: ["Marina Bay Sands"],
          price: ["Free"],
        },
        availableCapabilityIds: ["event.applyquery", "catalog.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-ingress" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-ingress" }),
  );
  await flushRelay();

  const configuration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  assert.deepEqual(
    configuration.tools.map(({ name }) => name),
    [],
  );
  assert.equal(configuration.tool_choice, "none");
  harness.relay.stop(sessionId, "user");
});

test("deterministic transcript routing sends a complete event request to event.applyquery", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 9,
        visibleTargets: [],
        activeOverlayId: "events",
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v9",
            contextRevision: 0,
          },
        },
        eventFacetCatalog: {
          catalogRevision: "events:v9",
          what: ["Exhibitions"],
          when: ["Today"],
          where: ["Marina Bay Sands"],
          price: ["Free"],
        },
        availableCapabilityIds: [
          "event.applyquery",
          "event.search",
          "catalog.search",
        ],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-event-ingress" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-event-ingress" }),
  );
  await emitFinalInputTranscript(
    harness,
    "find events today at Marina Bay Sands",
  );
  await flushRelay();

  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.match(proposal.callId, /^relay-fixture-/);
  assert.deepEqual(proposal, {
    type: "capability.proposed",
    callId: proposal.callId,
    capabilityId: "event.applyquery",
    kind: "command",
    arguments: {
      text: "find events today at Marina Bay Sands",
      mode: "replace",
      baseContextRevision: 9,
      catalogRevision: "events:v9",
    },
    contextRevision: 9,
  });
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "capability.proposed" &&
        ["catalog.search", "event.search"].includes(message.capabilityId),
    ),
    false,
  );
  const finalResult = {
    capabilityId: "event.applyquery",
    kind: "command",
    status: "completed",
    changed: false,
    affectedTargetIds: [],
    contextRevision: 9,
    data: {
      outcome: "applied",
      canonicalSentence: "Find events today at Marina Bay Sands",
      residualQuery: "",
      phrases: [
        {
          phraseId: "when:today",
          facet: "when",
          valueId: "today",
          label: "today",
        },
        {
          phraseId: "where:marina-bay-sands",
          facet: "where",
          valueId: "marina-bay-sands",
          label: "at Marina Bay Sands",
        },
      ],
      clarificationChoices: [],
      catalogRevision: "events:v9",
      resultCount: 4,
    },
    errorCode: null,
  };
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: proposal.callId,
      capabilityId: "event.applyquery",
      kind: "command",
      result: finalResult,
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  const finalConfiguration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  assert.deepEqual(finalConfiguration.tools, []);
  assert.equal(finalConfiguration.tool_choice, "none");
  harness.relay.stop(sessionId, "user");
});

test("deterministic transcript routing handles a single event filter atomically", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 2,
        visibleTargets: [],
        activeOverlayId: "events",
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v2",
            contextRevision: 2,
          },
        },
        availableCapabilityIds: ["event.applyquery", "event.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-event-single" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-event-single" }),
  );
  await flushRelay();
  await emitFinalInputTranscript(harness, "find exhibitions");
  await flushRelay();

  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.match(proposal.callId, /^relay-fixture-/);
  assert.deepEqual(proposal, {
    type: "capability.proposed",
    callId: proposal.callId,
    capabilityId: "event.applyquery",
    kind: "command",
    arguments: {
      text: "find exhibitions",
      mode: "replace",
      baseContextRevision: 2,
      catalogRevision: "events:v2",
    },
    contextRevision: 2,
  });
  harness.relay.stop(sessionId, "user");
});

test("deterministic transcript routing recognizes restaurants around the area", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        activeOverlayId: "assistant",
        availableCapabilityIds: [
          "restaurant.search",
          "restaurant.searchviewport",
          "map.zoomin",
        ],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-restaurants-area" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-restaurants-area" }),
  );
  await emitFinalInputTranscript(
    harness,
    "Can you help me find restaurants around the area?",
  );
  await flushRelay();

  const proposal = harness.browserMessages.findLast(
    ({ type }) => type === "capability.proposed",
  );
  assert.deepEqual(proposal, {
    type: "capability.proposed",
    callId: proposal.callId,
    capabilityId: "restaurant.searchviewport",
    kind: "command",
    arguments: {},
    contextRevision: 7,
  });
  harness.relay.stop(sessionId, "user");
});

test("ambiguous native requests ask for clarification without exposing actions", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 5,
        visibleTargets: [],
        activeFilters: {
          eventComposerState: {
            catalogRevision: "events:v5",
            contextRevision: 5,
          },
        },
        availableCapabilityIds: [
          "event.applyquery",
          "restaurant.search",
          "map.zoomin",
        ],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-ambiguous" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-ambiguous" }),
  );
  await emitFinalInputTranscript(harness, "find events and restaurants");
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  await flushRelay();

  const configuration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  assert.deepEqual(configuration.tools, []);
  assert.equal(configuration.tool_choice, "none");
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
  harness.relay.stop(sessionId, "user");
});

test("unsupported native transcripts expose no actions", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 6,
        visibleTargets: [],
        availableCapabilityIds: ["event.applyquery", "restaurant.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-unsupported" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-unsupported" }),
  );
  await emitFinalInputTranscript(
    harness,
    "Tell me who won the football match yesterday",
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  await flushRelay();
  const finalConfiguration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  assert.deepEqual(finalConfiguration.tools, []);
  assert.equal(finalConfiguration.tool_choice, "none");
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  assert.equal(harness.relay.sessions.has(sessionId), true);
  harness.relay.stop(sessionId, "user");
});

test("non-deterministic native requests expose one connector family and no foundational tools", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  const restaurantCapabilities = [
    "restaurant.search",
    "restaurant.searchviewport",
    "restaurant.setcategory",
    "restaurant.setcuisine",
    "restaurant.clearfilters",
    "restaurant.selectcluster",
    "restaurant.selectresult",
    "restaurant.closeresults",
    "restaurant.closedetail",
    "restaurant.addtoplan",
    "restaurant.openreference",
    "restaurant.opendealreference",
    "restaurant.opendirections",
  ];
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 3,
        visibleTargets: [],
        activeOverlayId: "restaurants",
        availableCapabilityIds: [
          ...restaurantCapabilities,
          "app.inspect",
          "catalog.search",
          "map.zoomin",
        ],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-restaurant" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-restaurant" }),
  );
  await emitFinalInputTranscript(
    harness,
    "find a nice Italian restaurant nearby",
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  await flushRelay();

  const configuration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  const toolNames = configuration.tools.map(({ name }) => name);
  assert.equal(toolNames.length > 1, true);
  assert.equal(toolNames.length <= 15, true);
  assert.equal(
    toolNames.every((name) => name.startsWith("restaurant__")),
    true,
  );
  assert.equal(
    toolNames.some((name) =>
      ["app__inspect", "catalog__search", "map__zoomin"].includes(name),
    ),
    false,
  );
  assert.equal(configuration.tool_choice, "auto");
  harness.relay.stop(sessionId, "user");
});

test("duplicate ingress fails closed before an application proposal", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 1,
        visibleTargets: [],
        availableCapabilityIds: ["restaurant.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-duplicate-ingress" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-duplicate-ingress" }),
  );
  await flushRelay();
  const ingress = {
    type: "response.function_call_arguments.done",
    name: "voice__classifyrequest",
    call_id: "call-duplicate-ingress",
    arguments: JSON.stringify({ domain: "other", eventQuery: null }),
  };
  harness.providerListeners.message({ data: JSON.stringify(ingress) });
  harness.providerListeners.message({ data: JSON.stringify(ingress) });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(
      ({ type, reason }) => type === "session.stopped" && reason === "protocol",
    ),
    true,
  );
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
});

test("native audio with event context exposes no tools before transcription", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  const eventQueryCapabilities = [
    "event.applyquery",
    "event.search",
    "event.setfilter",
    "event.removefilter",
    "event.clearfilters",
    "event.setcategory",
    "event.setdaterange",
    "event.setpricerange",
  ];

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 4,
        visibleTargets: [],
        availableCapabilityIds: [
          ...eventQueryCapabilities,
          "event.selectresult",
          "map.zoomin",
        ],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-event-query" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-event-query" }),
  );
  await flushRelay();

  const configuration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  const canonicalToolIds = configuration.tools.map(({ name }) =>
    name.replace("__", "."),
  );
  assert.deepEqual(canonicalToolIds, []);
  assert.equal(
    canonicalToolIds.some((capabilityId) =>
      eventQueryCapabilities.includes(capabilityId),
    ),
    false,
  );
  harness.relay.stop(sessionId, "user");
});

test("native audio never configures an LLM ingress classifier", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 5,
        visibleTargets: [],
        eventFacetCatalog: {
          catalogRevision: "events:v5",
          what: ["Exhibitions", "Concerts"],
          when: ["Today"],
          where: ["Marina Bay"],
          price: ["Free"],
        },
        availableCapabilityIds: ["event.applyquery", "event.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-event-contract" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-event-contract" }),
  );
  await flushRelay();

  const configuration = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  ).session;
  assert.deepEqual(configuration.tools, []);
  assert.equal(configuration.tool_choice, "none");
  harness.relay.stop(sessionId, "user");
});

test("missing transcription completion terminates at the bounded deadline", async () => {
  const records = [];
  const scheduled = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "turn.request",
      turnId: "turn-transcription-timeout",
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.commit",
      turnId: "turn-transcription-timeout",
    }),
  );
  await flushRelay();

  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.create"),
    false,
  );
  assert.equal(harness.relay.sessions.has(sessionId), true);
  assert.equal(scheduled.filter(({ delay }) => delay === 30_000).length, 1);
  scheduled[0].callback();
  await flushRelay();
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(
      ({ type, code }) => type === "error" && code === "provider_unavailable",
    ),
    true,
  );
  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed"],
  );
});

test("active transcription failures terminate without routing a request", async () => {
  const records = [];
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "turn.request",
      turnId: "turn-transcription-failed",
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.commit",
      turnId: "turn-transcription-failed",
    }),
  );
  await flushRelay();
  const responseCreates = harness.providerMessages.filter(
    ({ type }) => type === "response.create",
  ).length;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "input-item-failed",
      error: { type: "server_error", code: "transcription_failed" },
    }),
  });
  await flushRelay();

  assert.equal(
    harness.providerMessages.filter(({ type }) => type === "response.create")
      .length,
    responseCreates,
  );
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "error" && message.code === "provider_unavailable",
    ),
    true,
  );
  assert.deepEqual(
    records.map(({ phase }) => phase),
    ["audio_committed", "session_terminal"],
  );
});

test("a transcript for a different committed provider item fails closed", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-item-mismatch" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-item-mismatch" }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "input-item-expected",
    }),
  });
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-wrong",
      transcript: "find events today",
    }),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
});

test("a bounded post-commit VAD item is quarantined without disabling voice", async () => {
  const settlements = [];
  const holds = [];
  const harness = await createRelayHarness({
    budgetRepository: {
      async settle(input) {
        settlements.push(structuredClone(input));
      },
      async hold(input) {
        holds.push(structuredClone(input));
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-late-vad" }),
  );
  await flushRelay();
  for (const event of [
    {
      type: "input_audio_buffer.speech_started",
      item_id: "input-item-active",
    },
    {
      type: "input_audio_buffer.speech_stopped",
      item_id: "input-item-active",
    },
    {
      type: "input_audio_buffer.committed",
      item_id: "input-item-active",
    },
    {
      type: "input_audio_buffer.speech_started",
      item_id: "input-item-late",
    },
    {
      type: "input_audio_buffer.speech_stopped",
      item_id: "input-item-late",
    },
    {
      type: "input_audio_buffer.committed",
      item_id: "input-item-late",
    },
    {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-late",
      transcript: "late residual audio",
    },
    {
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-active",
      transcript: "",
    },
  ])
    harness.providerListeners.message({ data: JSON.stringify(event) });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), true);
  assert.equal(holds.length, 0);
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "session.stopped"),
    false,
  );
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
  assert.equal(
    settlements.filter(
      ({ usageShapeHash }) =>
        usageShapeHash === "sha256:provider-final-transcript-max-bound",
    ).length,
    1,
  );
  const responseCreate = harness.providerMessages
    .filter(({ type }) => type === "response.create")
    .at(-1);
  assert.match(responseCreate.response.instructions, /I didn't catch that/);
});

test("empty final transcripts settle and request one bounded retry without disabling voice", async () => {
  const settlements = [];
  const holds = [];
  const harness = await createRelayHarness({
    budgetRepository: {
      async settle(input) {
        settlements.push(structuredClone(input));
      },
      async hold(input) {
        holds.push(structuredClone(input));
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-empty" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "audio.commit", turnId: "turn-empty" }),
  );
  await flushRelay();
  await emitFinalInputTranscript(harness, "", "input-item-empty");

  assert.equal(harness.relay.sessions.has(sessionId), true);
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "capability.proposed"),
    false,
  );
  assert.equal(
    harness.browserMessages.some(({ type }) => type === "session.stopped"),
    false,
  );
  assert.equal(holds.length, 0);
  assert.equal(
    settlements.filter(
      ({ usageShapeHash }) =>
        usageShapeHash === "sha256:provider-final-transcript-max-bound",
    ).length,
    1,
  );
  const responseCreate = harness.providerMessages
    .filter(({ type }) => type === "response.create")
    .at(-1);
  assert.match(
    responseCreate.response.instructions,
    new RegExp(
      EMPTY_TRANSCRIPT_RETRY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
});

test("conflicting duplicate final transcripts fail closed", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "turn.request",
      turnId: "turn-conflicting-duplicate",
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.commit",
      turnId: "turn-conflicting-duplicate",
    }),
  );
  await flushRelay();
  await emitFinalInputTranscript(
    harness,
    "find events today",
    "input-item-duplicate",
  );
  assert.equal(harness.relay.sessions.has(sessionId), true);
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-duplicate",
      transcript: "find restaurants instead",
    }),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.filter(({ type }) => type === "capability.proposed")
      .length,
    0,
  );
});

test("audio exceeding the reserved transcription duration stops before forwarding", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-audio-bound" }),
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "input-item-audio-bound",
    }),
  });
  await flushRelay();
  const session = harness.relay.sessions.get(sessionId);
  session.inputAudioBytes = 60 * 24_000 * 2;
  const forwardsBefore = harness.providerMessages.filter(
    ({ type }) => type === "input_audio_buffer.append",
  ).length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "audio.append",
      turnId: "turn-audio-bound",
      audio: "AAAA",
    }),
  );

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.providerMessages.filter(
      ({ type }) => type === "input_audio_buffer.append",
    ).length,
    forwardsBefore,
  );
});

test("pending dialogue recovers application-level provider tool mistakes", async () => {
  const cases = [
    {
      name: "unknown tool",
      event: {
        type: "response.function_call_arguments.done",
        name: "unknown__tool",
        call_id: "call-unknown-pending",
        arguments: "{}",
      },
    },
    {
      name: "unavailable current tool",
      event: {
        type: "response.function_call_arguments.done",
        name: "map__zoomout",
        call_id: "call-unavailable-pending",
        arguments: "{}",
      },
    },
    {
      name: "unrelated valid tool",
      event: {
        type: "response.function_call_arguments.done",
        name: "map__zoomin",
        call_id: "call-unrelated-pending",
        arguments: "{}",
      },
    },
    {
      name: "malformed arguments",
      event: {
        type: "response.function_call_arguments.done",
        name: "event__addtoplan",
        call_id: "call-malformed-pending",
        arguments: "{",
      },
    },
    {
      name: "invalid schema",
      event: {
        type: "response.function_call_arguments.done",
        name: "event__addtoplan",
        call_id: "call-invalid-pending",
        arguments: '{"unexpected":true}',
      },
    },
  ];

  for (const candidate of cases) {
    const records = [];
    const harness = await createRelayHarness({
      operationalLogger: (record) => records.push(structuredClone(record)),
    });
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 6,
          visibleTargets: [
            { targetId: "event:one", type: "event", label: "Gallery Night" },
            { targetId: "event:two", type: "event", label: "Sunset Jazz" },
          ],
          availableCapabilityIds: ["event.addtoplan", "map.zoomin"],
        },
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-${candidate.name.replaceAll(" ", "-")}`,
        text: "use the map controls",
      }),
    );
    const session = harness.relay.sessions.get(sessionId);
    session.pendingDialogue = createPendingDialogue({
      dialogueId: `dialogue-${candidate.name.replaceAll(" ", "-")}`,
      capabilityId: "event.addtoplan",
      candidates: [
        {
          targetId: "event:one",
          label: "Gallery Night",
          arguments: { eventId: "event:one" },
        },
        {
          targetId: "event:two",
          label: "Sunset Jazz",
          arguments: { eventId: "event:two" },
        },
      ],
      contextRevision: 6,
      nowMs: 5_000,
    });

    harness.providerListeners.message({
      data: JSON.stringify(candidate.event),
    });
    await flushRelay();
    assert.equal(harness.relay.sessions.has(sessionId), true, candidate.name);
    assert.equal(session.pendingDialogue.status, "active", candidate.name);
    assert.equal(
      harness.browserMessages.some(
        ({ type }) => type === "capability.proposed",
      ),
      false,
      candidate.name,
    );

    harness.providerListeners.message({
      data: JSON.stringify(trustedResponseDone()),
    });
    await flushRelay();
    assert.match(
      harness.providerMessages.findLast(
        ({ type }) => type === "response.create",
      ).response.instructions,
      /Gallery Night|Sunset Jazz/,
      candidate.name,
    );
    harness.providerListeners.message({
      data: JSON.stringify(trustedResponseDone()),
    });
    await flushRelay();
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-recovery-${candidate.name.replaceAll(" ", "-")}`,
        text: "the first one",
      }),
    );
    assert.equal(
      harness.browserMessages.findLast(
        ({ type }) => type === "capability.proposed",
      )?.capabilityId,
      "event.addtoplan",
      candidate.name,
    );
    assert.equal(
      harness.browserMessages.some(
        ({ type, reason }) =>
          type === "session.stopped" && reason === "protocol",
      ),
      false,
      candidate.name,
    );
    assert.doesNotMatch(
      JSON.stringify(records),
      /Gallery Night|Sunset Jazz|event:one|event:two|call-|unknown__tool|map__zoomin|event__addtoplan|unexpected/i,
      candidate.name,
    );
  }
});

test("pending dialogue does not recover an invalid provider call identity", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        availableCapabilityIds: ["event.addtoplan", "map.zoomin"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-invalid-call-identity",
      text: "use the map controls",
    }),
  );
  const session = harness.relay.sessions.get(sessionId);
  session.pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-invalid-call-identity",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
    ],
    contextRevision: 7,
    nowMs: 5_000,
  });

  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "unknown__tool",
      call_id: "",
      arguments: "{}",
    }),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.findLast(({ type }) => type === "session.stopped")
      ?.reason,
    "protocol",
  );
});

test("pending dialogue does not recover a reused terminal call identity", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 8,
        visibleTargets: [
          { targetId: "event:one", type: "event", label: "Gallery Night" },
        ],
        availableCapabilityIds: ["event.addtoplan", "map.zoomin"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-reused-call-identity",
      text: "use the map controls",
    }),
  );
  const session = harness.relay.sessions.get(sessionId);
  session.pendingDialogue = createPendingDialogue({
    dialogueId: "dialogue-reused-call-identity",
    capabilityId: "event.addtoplan",
    candidates: [
      {
        targetId: "event:one",
        label: "Gallery Night",
        arguments: { eventId: "event:one" },
      },
    ],
    contextRevision: 8,
    nowMs: 5_000,
  });
  session.terminalCalls.set("call-already-finished", {
    callId: "call-already-finished",
    capabilityId: "map.zoomin",
    argumentsKey: "{}",
    result: { status: "completed", changed: true, data: null },
  });

  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "unknown__tool",
      call_id: "call-already-finished",
      arguments: "{}",
    }),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.findLast(({ type }) => type === "session.stopped")
      ?.reason,
    "protocol",
  );
});

test("native audio tool calls reject unavailable and malformed capabilities", async () => {
  for (const candidate of [
    {
      name: "unavailable capability",
      event: {
        type: "response.function_call_arguments.done",
        name: "map__zoomout",
        call_id: "call-unavailable",
        arguments: "{}",
      },
    },
    {
      name: "malformed arguments",
      event: {
        type: "response.function_call_arguments.done",
        name: "map__zoomin",
        call_id: "call-malformed",
        arguments: '{"unexpected":true}',
      },
    },
  ]) {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 1,
          visibleTargets: [],
          availableCapabilityIds: ["map.zoomin"],
        },
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "turn.request",
        turnId: `turn-${candidate.name.replaceAll(" ", "-")}`,
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "audio.commit",
        turnId: `turn-${candidate.name.replaceAll(" ", "-")}`,
      }),
    );

    harness.providerListeners.message({
      data: JSON.stringify(candidate.event),
    });
    await flushRelay();

    assert.equal(harness.relay.sessions.has(sessionId), false, candidate.name);
    assert.equal(
      harness.browserMessages.some(
        (message) =>
          message.type === "session.stopped" && message.reason === "protocol",
      ),
      true,
      candidate.name,
    );
    assert.equal(
      harness.browserMessages.some(
        (message) => message.type === "capability.proposed",
      ),
      false,
      candidate.name,
    );
  }
});

test("stalled responses cancel and terminate at the response deadline", async () => {
  const records = [];
  const held = [];
  const scheduled = [];
  const cleared = [];
  let currentMs = Date.parse("2026-07-29T10:00:00.000Z");
  const harness = await createRelayHarness({
    operationalLogger: (record) => records.push(structuredClone(record)),
    now: () => new Date(currentMs),
    responseSetTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    responseClearTimeout(timer) {
      cleared.push(timer);
    },
    budgetRepository: {
      async hold(value) {
        held.push(value);
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  assert.equal(harness.admitted.data.limits.responseTimeoutSeconds, 30);

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-timeout",
      text: "find events",
    }),
  );
  await flushRelay();
  const responseTimer = scheduled.find(({ delay }) => delay === 30_000);
  assert(responseTimer);
  currentMs += 30_000;
  responseTimer.callback();
  await flushRelay();

  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.cancel"),
    true,
  );
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(held.length, 1);
  assert.equal(held[0].reason, "terminal_without_trusted_usage");
  assert.equal(records.at(-1).phase, "response_timeout");
  assert.equal(records.at(-1).terminalReason, "response_timeout");
  assert.equal(cleared.includes(responseTimer), true);
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "error" &&
        message.code === "provider_unavailable" &&
        message.message === VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    ),
    true,
  );
  assert.equal(
    harness.browserMessages.some(
      (message) =>
        message.type === "session.stopped" &&
        message.reason === "response_timeout",
    ),
    true,
  );
});

test("failed per-stage budget admission stops before declaring a turn ready", async () => {
  const harness = await createRelayHarness({
    budgetRepository: {
      async reserve() {
        throw new Error("budget unavailable");
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-budget-denied" }),
  );
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(
      ({ type, turnId }) =>
        type === "turn.ready" && turnId === "turn-budget-denied",
    ),
    false,
  );
  assert.equal(
    harness.browserMessages.some(
      ({ type, reason }) =>
        type === "session.stopped" && reason === "usage_limit",
    ),
    true,
  );
});

const inspectCapabilityResult = (revision = 7) => ({
  capabilityId: "app.inspect",
  kind: "query",
  status: "completed",
  changed: null,
  affectedTargetIds: [],
  contextRevision: revision,
  data: {
    revision,
    stateDigest: `sha256:context-${revision}`,
    viewport: { zoom: 12, bearing: 0 },
    visibleLayers: {
      recommendations: false,
      location: false,
      mrtStations: false,
      mrtLines: false,
    },
    visibleTargets: [],
    focusedTargetId: null,
    selectedTargetIds: [],
    activeOverlayId: null,
    assistantPresentation: null,
    activeFilters: {},
    plan: { stopIds: [], travelMode: "walking", routeAvailable: false },
    location: {
      permission: "prompt",
      status: "idle",
      coarseAreaId: null,
    },
    transit: { visible: false, constraintActive: false },
    availableCapabilityIds: ["app.inspect", "catalog.get", "catalog.search"],
  },
  errorCode: null,
});
const trustedResponseDone = () => {
  const completion = fixture("transcript-provider-events.json").events.find(
    (event) => event.type === "response.done",
  );
  return {
    type: "response.done",
    response: { usage: structuredClone(completion.usage) },
  };
};

test("explicit content diagnostics trace all relay boundaries with permitted content and terminal cleanup", async () => {
  const records = [];
  const harness = await createRelayHarness({
    contentDebugLogger: (record) => records.push(structuredClone(record)),
  });
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-debug",
      text: "find jazz near Bugis",
    }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "app__inspect",
      call_id: "call-debug",
      arguments: "{}",
      api_key: "sk-provider-secret",
    }),
  });
  await flushRelay();
  await flushRelay();
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-debug",
      capabilityId: "app.inspect",
      kind: "query",
      result: inspectCapabilityResult(),
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.output_audio.delta",
      delta: "UklGRkFVRElP",
    }),
  });
  await flushRelay();

  assert.deepEqual(
    [...new Set(records.map(({ direction }) => direction))].sort(),
    [
      "browser_to_relay",
      "provider_to_relay",
      "relay_to_browser",
      "relay_to_provider",
    ],
  );
  assert.equal(
    records.every(
      ({ event, sessionIdHash }) =>
        event === "voice.content_debug" &&
        sessionIdHash === "sha256:relay-fixture",
    ),
    true,
  );
  const serialized = JSON.stringify(records);
  assert.match(serialized, /find jazz near Bugis/);
  assert.match(serialized, /Current eligible capabilities/);
  assert.match(serialized, /call-debug/);
  assert.match(serialized, /stateDigest/);
  assert.doesNotMatch(serialized, /sk-provider-secret|UklGRkFVRElP/);
  assert.match(serialized, /"omitted":true/);

  harness.relay.stop(sessionId, "user");
  const stoppedCount = records.length;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.created",
      transcript: "late content",
    }),
  });
  await flushRelay();
  assert.equal(records.length, stoppedCount);
  assert.doesNotMatch(JSON.stringify(records), /relay-fixture-1/);
});

test("session admission returns only bounded public configuration", () => {
  const result = validateSessionAdmission(admission());

  assert.deepEqual(result, {
    protocolVersion: "1.1",
    capabilities: { audioInput: true, audioOutput: true, text: true },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /api.?key|credential|providerCall|remaining.*(?:usd|balance)|usage/i,
  );
});

test("session admission fails closed for every trust and capacity gate", () => {
  const cases = [
    ["origin_rejected", { origin: "https://attacker.example" }],
    ["invalid_request", { contentType: "text/plain" }],
    ["invalid_request", { bodyBytes: 65 * 1024 }],
    ["voice_disabled", { environmentEnabled: false }],
    ["voice_disabled", { runtimeEnabled: false }],
    ["policy_mismatch", { providerPolicyValid: false }],
    ["policy_mismatch", { rateCardValid: false }],
    ["usage_limit", { reservationAvailable: false }],
    ["rate_limited", { rateLimited: true }],
    [
      "invalid_request",
      {
        body: {
          protocolVersion: "1.1",
          disclosureAccepted: false,
          capabilities: { audioInput: true, audioOutput: true, text: true },
        },
      },
    ],
  ];

  for (const [code, override] of cases)
    throwsCode(() => validateSessionAdmission(admission(override)), code);
});

test("session admission requires the exact protocol 1.1 version", () => {
  for (const protocolVersion of ["1.0", "1.2", "2.0", null])
    throwsCode(
      () =>
        validateSessionAdmission(
          admission({
            body: {
              ...admission().body,
              protocolVersion,
            },
          }),
        ),
      "invalid_request",
    );
});

test("Amble's session contract rejects general chat and describes only eligible app capabilities", () => {
  const tools = [
    {
      type: "function",
      name: "map.zoomin",
      description: "Increase the map zoom by one step.",
      parameters: { type: "object", additionalProperties: false },
    },
    {
      type: "function",
      name: "event.search",
      description: "Search approved events already available in Amble.",
      parameters: { type: "object", additionalProperties: false },
    },
  ];

  assert.deepEqual(describeAvailableCapabilities(tools), [
    "map.zoomin: Increase the map zoom by one step.",
    "event.search: Search approved events already available in Amble.",
  ]);

  const instructions = buildAmbleSessionInstructions(tools);
  assert.match(instructions, /You are Amble/i);
  assert.match(instructions, /not a general-purpose assistant/i);
  assert.match(
    instructions,
    /I can only help you explore Singapore and use Amble/i,
  );
  assert.match(instructions, /must not browse or search the open web/i);
  assert.match(instructions, /tool result confirms/i);
  assert.match(instructions, /map\.zoomin: Increase the map zoom/i);
  assert.match(instructions, /event\.search: Search approved events/i);
  assert.doesNotMatch(instructions, /browser automation|unrestricted control/i);
});

test("Amble's capability description never includes actions absent from current context", () => {
  const instructions = buildAmbleSessionInstructions([
    {
      type: "function",
      name: "map.zoomout",
      description: "Decrease the map zoom by one step.",
      parameters: { type: "object", additionalProperties: false },
    },
  ]);

  assert.match(instructions, /map\.zoomout/);
  assert.doesNotMatch(instructions, /event\.search|navigation\.openexternal/);
});

test("Amble's welcome is absent from persistent session instructions", () => {
  const instructions = buildAmbleSessionInstructions([]);

  assert.equal(
    AMBLE_WELCOME_MESSAGE,
    "Hi, I'm Amble, your Singapore discovery guide. Tell me what you're in the mood for—I can find events, restaurants, and places, or help you explore the map.",
  );
  assert.match(instructions, /Natural phrasing is allowed/);
  assert.match(instructions, /never add an action, result, fact, promise/i);
  assert.doesNotMatch(
    instructions,
    new RegExp(AMBLE_WELCOME_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(instructions, /opening greeting|simple hello/i);
  assert.doesNotMatch(
    instructions,
    /what's up|tiny mystery|just saying hello/i,
  );
  assert.match(
    instructions,
    new RegExp(OUT_OF_SCOPE_RESPONSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(instructions, /offer a relevant in-app alternative/i);
});

test("fixed speech instructions allow faithful natural phrasing", () => {
  const instructions = buildFixedSpeechInstructions(AMBLE_WELCOME_MESSAGE);

  assert.equal(instructions.split(AMBLE_WELCOME_MESSAGE).length - 1, 1);
  assert.match(instructions, /Natural paraphrasing is allowed/);
  assert.match(instructions, /do not add actions, results, facts, promises/i);
  assert.doesNotMatch(instructions, /SPEAK EXACTLY|VERBATIM/);
});

test("a natural fixed-response paraphrase does not retry or stop voice", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 3,
        visibleTargets: [],
        availableCapabilityIds: ["event.applyquery", "restaurant.search"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-natural-fixed-speech",
      text: "find events and restaurants",
    }),
  );
  await flushRelay();

  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.output_audio_transcript.done",
      item_id: "item-natural-fixed-speech",
      transcript: "Which Amble feature would you like to use?",
    }),
  });
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), true);
  assert.equal(
    harness.providerMessages.filter(({ type }) => type === "response.create")
      .length,
    1,
  );
  assert.equal(
    harness.browserMessages.findLast(
      ({ type }) => type === "assistant.text.done",
    )?.text,
    "Which Amble feature would you like to use?",
  );
  assert.equal(
    harness.browserMessages.some(
      ({ type, reason }) => type === "session.stopped" && reason === "protocol",
    ),
    false,
  );
  harness.relay.stop(sessionId, "user");
});

test("a new voice session reserves and starts Amble's welcome before user audio", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const providerMessages = [];
  const browserMessages = [];
  const reservations = [];
  const operationalRecords = [];
  const providerListeners = {};
  const providerSocket = createSocket(providerMessages, providerListeners);
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
      },
      async settle() {},
      async hold() {},
    },
    providerConnector: async () => providerSocket,
    randomId: () => `welcome-fixture-${++identity}`,
    hash: async () => "sha256:welcome-fixture",
    now: () => new Date("2026-07-29T17:00:00.000Z"),
    operationalLogger: (record) =>
      operationalRecords.push(structuredClone(record)),
  });
  const admitted = await relay.admit(admission());

  await relay.attach(admitted.data.sessionId, createSocket(browserMessages));
  const initialUpdate = providerMessages.findLast(
    (message) => message.type === "session.update",
  );
  providerListeners.message({
    data: JSON.stringify({
      type: "session.updated",
      session: structuredClone(initialUpdate.session),
    }),
  });
  await flushRelay();

  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].kind, "response");
  assert.equal(browserMessages.at(-1).type, "session.state");
  assert.equal(browserMessages.at(-1).state, "processing");
  assert.deepEqual(
    operationalRecords.map(({ phase }) => phase),
    ["response_requested"],
  );
  assert.equal(
    providerMessages.some(
      (message) =>
        message.type === "conversation.item.create" &&
        message.item?.content?.some(({ text }) =>
          text?.includes(AMBLE_WELCOME_MESSAGE),
        ),
    ),
    false,
  );
  assert.equal(providerMessages.at(-1).type, "response.create");
  assert.equal(
    providerMessages.at(-1).response.instructions,
    buildFixedSpeechInstructions(AMBLE_WELCOME_MESSAGE),
  );
  assert.equal("max_output_tokens" in providerMessages.at(-1).response, false);
  assert.equal(
    "responseCount" in relay.sessions.get(admitted.data.sessionId),
    false,
  );
});

test("provider configuration acknowledgement gates every response", async () => {
  const harness = await createRelayHarness({
    autoAcknowledgeConfiguration: false,
  });
  const sessionId = harness.admitted.data.sessionId;
  assert.deepEqual(
    harness.providerMessages.map(({ type }) => type),
    ["session.update"],
  );

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-config-barrier",
      text: "find events",
    }),
  );
  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.create"),
    false,
  );
  assert.notEqual(
    harness.relay.sessions.get(sessionId).desiredConfigurationTools,
    null,
  );

  const initialUpdate = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  );
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "session.updated",
      session: structuredClone(initialUpdate.session),
    }),
  });
  await flushRelay();
  await flushRelay();
  const turnUpdate = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  );
  assert.notEqual(turnUpdate, initialUpdate);
  assert.equal(
    harness.providerMessages.some(({ type }) => type === "response.create"),
    false,
  );

  harness.providerListeners.message({
    data: JSON.stringify({
      type: "session.updated",
      session: structuredClone(turnUpdate.session),
    }),
  });
  await flushRelay();
  assert.equal(
    harness.providerMessages.filter(({ type }) => type === "response.create")
      .length,
    1,
  );
});

test("provider configuration errors terminate instead of continuing generically", async () => {
  const harness = await createRelayHarness({
    autoAcknowledgeConfiguration: false,
  });
  const sessionId = harness.admitted.data.sessionId;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_value",
        message: "provider fixture detail",
      },
    }),
  });
  await flushRelay();
  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.deepEqual(harness.browserMessages.slice(-2), [
    {
      type: "error",
      code: "provider_unavailable",
      message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    },
    { type: "session.stopped", reason: "provider" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(harness.browserMessages),
    /provider fixture detail/,
  );
});

test("missing, stale, and mismatched provider configuration acknowledgements fail closed", async () => {
  {
    const scheduled = [];
    const harness = await createRelayHarness({
      autoAcknowledgeConfiguration: false,
      configurationSetTimeout(callback, delay) {
        const timer = { callback, delay };
        scheduled.push(timer);
        return timer;
      },
    });
    const sessionId = harness.admitted.data.sessionId;
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 30_000);
    scheduled[0].callback();
    assert.equal(harness.relay.sessions.has(sessionId), false);
    assert.deepEqual(harness.browserMessages.slice(-2), [
      {
        type: "error",
        code: "provider_unavailable",
        message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
      },
      { type: "session.stopped", reason: "provider" },
    ]);
  }

  for (const acknowledgement of ["mismatched", "duplicate"]) {
    const harness = await createRelayHarness({
      autoAcknowledgeConfiguration: false,
    });
    const sessionId = harness.admitted.data.sessionId;
    const update = harness.providerMessages.findLast(
      ({ type }) => type === "session.update",
    );
    const session = structuredClone(update.session);
    if (acknowledgement === "mismatched") session.tool_choice = "auto";
    harness.providerListeners.message({
      data: JSON.stringify({ type: "session.updated", session }),
    });
    await flushRelay();
    if (acknowledgement === "duplicate") {
      harness.providerListeners.message({
        data: JSON.stringify({ type: "session.updated", session }),
      });
      await flushRelay();
    }
    assert.equal(harness.relay.sessions.has(sessionId), false);
    assert.equal(harness.browserMessages.at(-1).reason, "protocol");
  }
});

test("provider tools use safe aliases while browser calls retain canonical IDs", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 4,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-alias",
      text: "adjust the map",
    }),
  );
  const update = harness.providerMessages.findLast(
    ({ type }) => type === "session.update",
  );
  assert.ok(
    update.session.tools.every(({ name }) => /^[a-zA-Z0-9_-]+$/.test(name)),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-alias",
      name: "map__zoomin",
      arguments: "{}",
    }),
  });
  await flushRelay();
  assert.equal(
    harness.browserMessages.findLast(
      ({ type }) => type === "capability.proposed",
    ).capabilityId,
    "map.zoomin",
  );
});

test("browser message validation accepts only the declared protocol allowlist", () => {
  const allowed = [
    { type: "turn.request", turnId: "turn-001" },
    { type: "audio.append", turnId: "turn-001", audio: "fixture-audio" },
    { type: "audio.commit", turnId: "turn-001" },
    { type: "text.submit", turnId: "turn-002", text: "Somewhere calm" },
    {
      type: "capability.result",
      callId: "call-001",
      capabilityId: "map.openarea",
      kind: "command",
      result: {
        capabilityId: "map.openarea",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: ["ura-subzone:marina-south"],
        contextRevision: 2,
        data: { focusedAreaId: "ura-subzone:marina-south" },
        errorCode: null,
      },
    },
    {
      type: "confirmation.pending",
      callId: "call-confirm-001",
      capabilityId: "navigation.openexternal",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
      targetId: "event:1",
      effectSummary: "Open the approved official event page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    },
    {
      type: "confirmation.result",
      callId: "call-001",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
      finalUserInput: true,
      decision: "rejected",
    },
    {
      type: "deterministic.result",
      capabilityId: "map.zoomin",
      kind: "command",
      result: {
        capabilityId: "map.zoomin",
        kind: "command",
        status: "completed",
        changed: true,
        affectedTargetIds: [],
        contextRevision: 2,
        data: { actionId: "map.zoomin", changed: true },
        errorCode: null,
      },
    },
    { type: "session.stop", reason: "user" },
  ];
  const options = {
    activeReservedTurnId: "turn-001",
    pendingCallIds: new Set(["call-001"]),
    pendingConfirmation: {
      callId: "call-001",
      confirmationId: "confirmation-001",
      fingerprint: "fixture-fingerprint-001",
    },
    pendingCalls: new Map([
      [
        "call-001",
        {
          capabilityId: "map.openarea",
          kind: "command",
        },
      ],
      [
        "call-confirm-001",
        {
          capabilityId: "navigation.openexternal",
          kind: "command",
          confirmationClass: "consequential",
        },
      ],
    ]),
    pendingDeterministic: {
      capabilityId: "map.zoomin",
      kind: "command",
      proposalRevision: 1,
      validateResult() {},
    },
    maxMessageBytes: 4096,
    maxAudioChunkBytes: 1024,
    maxTextChars: 512,
  };

  for (const message of allowed)
    assert.equal(
      validateBrowserMessage(
        message,
        message.type === "confirmation.pending"
          ? { ...options, pendingConfirmation: null }
          : options,
      ).type,
      message.type,
    );

  for (const type of [
    "response.create",
    "session.update",
    "conversation.item.create",
    "provider.forward",
    "tool.execute",
  ])
    throwsCode(
      () => validateBrowserMessage({ type }, options),
      "browser_message_unapproved",
    );
  for (const invalidStop of [
    { type: "session.stop" },
    { type: "session.stop", reason: "network" },
  ])
    throwsCode(
      () => validateBrowserMessage(invalidStop, options),
      "browser_message_unapproved",
    );
  throwsCode(
    () =>
      validateBrowserMessage(
        { type: "session.stop", reason: "user", detail: "not allowed" },
        options,
      ),
    "browser_field_unapproved",
  );
});

test("browser terminal reason is preserved by the relay", async () => {
  for (const reason of ["user", "pagehide", "permission"]) {
    const records = [];
    const harness = await createRelayHarness({
      operationalLogger: (record) => records.push(structuredClone(record)),
    });
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-${reason}`,
        text: "find events",
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({ type: "session.stop", reason }),
    );
    assert.equal(harness.relay.sessions.has(sessionId), false);
    assert.equal(harness.browserMessages.at(-1)?.reason, reason);
    assert.equal(records.at(-1)?.terminalReason, reason);
  }
});

test("pagehide voids a newly reserved uncommitted audio turn after a completed turn", async () => {
  const settlements = [];
  const holds = [];
  const harness = await createRelayHarness({
    budgetRepository: {
      async reserve() {},
      async settle(entry) {
        settlements.push(structuredClone(entry));
      },
      async hold(entry) {
        holds.push(structuredClone(entry));
      },
    },
  });
  const sessionId = harness.admitted.data.sessionId;
  const session = harness.relay.sessions.get(sessionId);

  // Reproduce the state left by a previous committed turn whose reservations
  // have already settled, then begin listening for the next turn.
  session.inputCommitted = true;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-after-completion" }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({ type: "session.stop", reason: "pagehide" }),
  );
  await flushRelay();

  assert.deepEqual(holds, []);
  assert.equal(settlements.length, 2);
  assert.equal(
    settlements.every(
      ({ settledMicroUsd, usageShapeHash }) =>
        settledMicroUsd === 0 && usageShapeHash === "sha256:no-billable-event",
    ),
    true,
  );
});

test("consequential provider calls use browser-owned confirmation and always complete", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [
          { targetId: "event:fixture", type: "event", label: "Fixture" },
        ],
        availableCapabilityIds: ["navigation.openexternal"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-navigation",
      text: "open the official reference",
    }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-navigation-001",
      name: "navigation__openexternal",
      arguments: JSON.stringify({
        targetId: "event:fixture",
        linkKind: "reference",
      }),
    }),
  });
  await flushRelay();

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "confirmation.pending",
      callId: "call-navigation-001",
      capabilityId: "navigation.openexternal",
      confirmationId: "confirmation-navigation-001",
      fingerprint: "sha256:confirmation-navigation-001",
      targetId: "event:fixture",
      effectSummary: "Open the approved official event page.",
      expiresAt: "2026-07-26T10:00:25.000Z",
    }),
  );
  assert.equal(harness.browserMessages.at(-1).type, "confirmation.required");

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "confirmation.result",
      callId: "call-navigation-001",
      confirmationId: "confirmation-navigation-001",
      fingerprint: "sha256:confirmation-navigation-001",
      finalUserInput: true,
      decision: "rejected",
    }),
  );
  const rejected = {
    capabilityId: "navigation.openexternal",
    kind: "command",
    status: "failed",
    changed: false,
    affectedTargetIds: [],
    contextRevision: 7,
    data: null,
    errorCode: "confirmation_required",
  };
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-navigation-001",
      capabilityId: "navigation.openexternal",
      kind: "command",
      result: rejected,
    }),
  );

  assert.equal(harness.relay.sessions.get(sessionId).pendingCalls.size, 0);
  assert.equal(harness.relay.sessions.get(sessionId).pendingConfirmation, null);
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-navigation-001",
    capabilityId: "navigation.openexternal",
    kind: "command",
    result: rejected,
  });
  const proposalCount = harness.browserMessages.filter(
    ({ type }) => type === "capability.proposed",
  ).length;
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-navigation-001",
      name: "navigation__openexternal",
      arguments: JSON.stringify({
        linkKind: "reference",
        targetId: "event:fixture",
      }),
    }),
  });
  await flushRelay();
  assert.equal(
    harness.browserMessages.filter(({ type }) => type === "capability.proposed")
      .length,
    proposalCount,
  );
  assert.equal(harness.relay.sessions.get(sessionId).pendingCalls.size, 0);
});

test("deterministic commands delay the model reply until the browser returns an outcome", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  const providerStart = harness.providerMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-deterministic",
      text: "zoom in",
    }),
  );
  assert.equal(
    harness.providerMessages
      .slice(providerStart)
      .some(({ type }) => type === "response.create"),
    false,
  );

  const result = {
    capabilityId: "map.zoomin",
    kind: "command",
    status: "completed",
    changed: true,
    affectedTargetIds: [],
    contextRevision: 8,
    data: { actionId: "map.zoomin", changed: true },
    errorCode: null,
  };
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "deterministic.result",
      capabilityId: "map.zoomin",
      kind: "command",
      result,
    }),
  );
  await flushRelay();

  assert.equal(
    harness.relay.sessions.get(sessionId).pendingDeterministic,
    null,
  );
  assert.equal(harness.providerMessages.at(-1).type, "response.create");
  assert.match(
    harness.providerMessages.findLast(
      ({ type }) => type === "conversation.item.create",
    ).item.content[0].text,
    /completed/i,
  );
});

test("deterministic unavailable and failed outcomes are authoritative before acknowledgement", async () => {
  for (const [status, errorCode] of [
    ["unavailable", "unavailable"],
    ["failed", "execution_failed"],
  ]) {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 7,
          visibleTargets: [],
          availableCapabilityIds: ["map.zoomin"],
        },
      }),
    );
    await flushRelay();
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-deterministic-${status}`,
        text: "zoom in",
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "deterministic.result",
        capabilityId: "map.zoomin",
        kind: "command",
        result: {
          capabilityId: "map.zoomin",
          kind: "command",
          status,
          changed: false,
          affectedTargetIds: [],
          contextRevision: 7,
          data: null,
          errorCode,
        },
      }),
    );
    await flushRelay();

    assert.match(
      harness.providerMessages.findLast(
        ({ type }) => type === "conversation.item.create",
      ).item.content[0].text,
      new RegExp(`"status":"${status}"`),
    );
    assert.equal(harness.providerMessages.at(-1).type, "response.create");
  }
});

test("deterministic turns remain active beyond the former count, idle, and duration thresholds", async () => {
  let currentMs = Date.parse("2026-07-26T10:00:00.000Z");
  const harness = await createRelayHarness({
    now: () => new Date(currentMs),
  });
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );

  for (let turn = 1; turn <= 7; turn += 1) {
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-unbounded-${turn}`,
        text: "zoom in",
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "deterministic.result",
        capabilityId: "map.zoomin",
        kind: "command",
        result: {
          capabilityId: "map.zoomin",
          kind: "command",
          status: "completed",
          changed: false,
          affectedTargetIds: [],
          contextRevision: 7,
          data: { actionId: "map.zoomin", changed: false },
          errorCode: null,
        },
      }),
    );
    await flushRelay();
    harness.providerListeners.message({
      data: JSON.stringify(trustedResponseDone()),
    });
    await flushRelay();
    currentMs += 70_000;
  }

  assert.equal(harness.relay.sessions.has(sessionId), true);
  assert.equal(harness.relay.sessions.get(sessionId).turnNumber, 7);
  assert.equal(
    harness.providerMessages.filter(({ type }) => type === "response.create")
      .length,
    7,
  );
  assert.equal(
    harness.browserMessages.some(
      ({ type, reason }) =>
        type === "session.stopped" &&
        ["idle", "duration", "response_limit"].includes(reason),
    ),
    false,
  );
  harness.relay.stop(sessionId, "user");
});

test("a fourth provider stage in one turn fails closed", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-stage-loop",
      text: "inspect the current application",
    }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-stage-loop",
      name: "app__inspect",
      arguments: "{}",
    }),
  });
  await flushRelay();
  harness.relay.sessions.get(sessionId).responseStageCount = 3;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-stage-loop",
      capabilityId: "app.inspect",
      kind: "query",
      result: inspectCapabilityResult(0),
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();

  assert.equal(harness.relay.sessions.has(sessionId), false);
  assert.equal(
    harness.browserMessages.some(
      ({ type, reason }) => type === "session.stopped" && reason === "protocol",
    ),
    true,
  );
});

test("audio and text remain bounded and require an admitted turn", () => {
  const options = {
    activeReservedTurnId: "turn-001",
    maxMessageBytes: 4096,
    maxAudioChunkBytes: 32,
    maxTextChars: 24,
  };

  throwsCode(
    () =>
      validateBrowserMessage(
        { type: "audio.append", turnId: "turn-other", audio: "fixture" },
        options,
      ),
    "turn_not_ready",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "audio.append",
          turnId: "turn-001",
          audio: "x".repeat(33),
        },
        options,
      ),
    "audio_chunk_too_large",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "text.submit",
          turnId: "turn-002",
          text: "x".repeat(25),
        },
        options,
      ),
    "text_too_large",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        { type: "text.submit", turnId: "turn-002", text: "ok" },
        { ...options, maxMessageBytes: 8 },
      ),
    "browser_message_too_large",
  );
});

test("modified clients cannot set provider-owned session or response fields", () => {
  const options = { maxMessageBytes: 4096, maxTextChars: 512 };
  for (const field of [
    "model",
    "rateCardVersion",
    "instructions",
    "tools",
    "maxOutputTokens",
    "automaticResponseCreation",
    "providerEventType",
  ])
    throwsCode(
      () =>
        validateBrowserMessage(
          { type: "turn.request", turnId: "turn-001", [field]: "modified" },
          options,
        ),
      "browser_field_unapproved",
    );
});

test("provider events are mapped to a small sanitized browser vocabulary", () => {
  const transcript = sanitizeProviderEvent({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "user-item-001",
    delta: "Somewhere calm",
    response_id: "provider-response-secret",
  });
  assert.deepEqual(transcript, {
    browserEvent: {
      type: "transcript.delta",
      itemId: "user-item-001",
      role: "user",
      text: "Somewhere calm",
    },
    trustedUsage: null,
  });

  const providerCompletion = fixture(
    "transcript-provider-events.json",
  ).events.find((event) => event.type === "response.done");
  const completion = sanitizeProviderEvent({
    type: "response.done",
    response_id: "provider-response-secret",
    api_key: "fixture-secret",
    response: { usage: providerCompletion.usage },
  });
  assert.equal(completion.browserEvent, null);
  assert.deepEqual(completion.trustedUsage, providerCompletion.usage);
  assert.deepEqual(
    sanitizeProviderEvent({
      type: "response.output_audio.delta",
      delta: "AQIDBA==",
    }).browserEvent,
    { type: "assistant.audio.delta", audio: "AQIDBA==" },
  );
  assert.doesNotMatch(
    JSON.stringify(completion.browserEvent),
    /response-secret|fixture-secret|usage|api_key/i,
  );

  assert.equal(
    sanitizeProviderEvent({ type: "unknown.provider.event", data: "secret" }),
    null,
  );
});

test("capability results cannot smuggle arbitrary provider events or calls", () => {
  const options = {
    pendingCallIds: new Set(["call-001"]),
    maxMessageBytes: 4096,
  };
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "capability.result",
          callId: "unknown-call",
          capabilityId: "map.openarea",
          kind: "command",
          result: {
            capabilityId: "map.openarea",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: 2,
            data: {},
            errorCode: null,
          },
        },
        options,
      ),
    "capability_call_unmatched",
  );
  throwsCode(
    () =>
      validateBrowserMessage(
        {
          type: "capability.result",
          callId: "call-001",
          capabilityId: "map.openarea",
          kind: "command",
          result: {
            capabilityId: "map.openarea",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: 2,
            data: {},
            errorCode: null,
          },
          providerEventType: "response.create",
        },
        options,
      ),
    "browser_field_unapproved",
  );
});

test("relay completes a validated query before allowing provider continuation", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-inspect",
      text: "inspect the current application",
    }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-inspect-001",
      name: "app__inspect",
      arguments: "{}",
    }),
  });
  await flushRelay();

  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.proposed",
    callId: "call-inspect-001",
    capabilityId: "app.inspect",
    kind: "query",
    arguments: {},
    contextRevision: 0,
  });

  const providerStart = harness.providerMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-inspect-001",
      capabilityId: "app.inspect",
      kind: "query",
      result: inspectCapabilityResult(0),
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();

  assert.deepEqual(
    harness.providerMessages.slice(providerStart).map(({ type }) => type),
    ["session.update", "conversation.item.create", "response.create"],
  );
  assert.deepEqual(
    JSON.parse(harness.providerMessages[providerStart + 1].item.output),
    inspectCapabilityResult(0),
  );
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-inspect-001",
    capabilityId: "app.inspect",
    kind: "query",
    result: inspectCapabilityResult(0),
  });
});

test("changed command completion waits for refreshed context and tools", async () => {
  const harness = await createRelayHarness();
  const sessionId = harness.admitted.data.sessionId;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 7,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "text.submit",
      turnId: "turn-map-command",
      text: "adjust the map",
    }),
  );
  await flushRelay();
  harness.providerListeners.message({
    data: JSON.stringify({
      type: "response.function_call_arguments.done",
      call_id: "call-zoom-001",
      name: "map__zoomin",
      arguments: "{}",
    }),
  });
  await flushRelay();

  const result = {
    capabilityId: "map.zoomin",
    kind: "command",
    status: "completed",
    changed: true,
    affectedTargetIds: [],
    contextRevision: 8,
    data: { actionId: "map.zoomin", changed: true },
    errorCode: null,
  };
  const providerStart = harness.providerMessages.length;
  const browserStart = harness.browserMessages.length;
  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "capability.result",
      callId: "call-zoom-001",
      capabilityId: "map.zoomin",
      kind: "command",
      result,
    }),
  );
  assert.equal(harness.providerMessages.length, providerStart);
  assert.equal(harness.browserMessages.length, browserStart);

  await harness.relay.handleBrowserMessage(
    sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 8,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomout"],
      },
    }),
  );
  harness.providerListeners.message({
    data: JSON.stringify(trustedResponseDone()),
  });
  await flushRelay();

  assert.deepEqual(
    harness.providerMessages.slice(providerStart).map(({ type }) => type),
    [
      "conversation.item.create",
      "session.update",
      "conversation.item.create",
      "response.create",
    ],
  );
  assert.deepEqual(
    harness.relay.sessions.get(sessionId).tools.map(({ name }) => name),
    [],
  );
  assert.equal(
    harness.providerMessages[providerStart + 2].item.type,
    "function_call_output",
  );
  assert.deepEqual(harness.browserMessages.at(-1), {
    type: "capability.completed",
    callId: "call-zoom-001",
    capabilityId: "map.zoomin",
    kind: "command",
    result,
  });
});

test("invalid, stale, or overlapping capability calls fail closed and clean up", async () => {
  for (const failure of [
    "common_envelope",
    "proposal_schema",
    "specific_result",
    "stale_revision",
    "overlap",
  ]) {
    const harness = await createRelayHarness();
    const sessionId = harness.admitted.data.sessionId;
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "context.update",
        context: {
          revision: 7,
          visibleTargets: [],
          availableCapabilityIds: ["map.zoomin"],
        },
      }),
    );
    await harness.relay.handleBrowserMessage(
      sessionId,
      JSON.stringify({
        type: "text.submit",
        turnId: `turn-map-${failure}`,
        text: "adjust the map",
      }),
    );
    harness.providerListeners.message({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call-first",
        name: "map__zoomin",
        arguments:
          failure === "proposal_schema"
            ? JSON.stringify({ selector: "#unapproved" })
            : "{}",
      }),
    });
    await flushRelay();

    if (failure === "proposal_schema") {
      assert.equal(harness.relay.sessions.has(sessionId), false, failure);
      continue;
    } else if (failure === "overlap") {
      harness.providerListeners.message({
        data: JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "call-second",
          name: "app__inspect",
          arguments: "{}",
        }),
      });
      await flushRelay();
    } else {
      await harness.relay.handleBrowserMessage(
        sessionId,
        JSON.stringify({
          type: "capability.result",
          callId: "call-first",
          capabilityId: "map.zoomin",
          kind: "command",
          result: {
            capabilityId: "map.zoomin",
            kind: "command",
            status: "completed",
            changed: true,
            affectedTargetIds: [],
            contextRevision: failure === "stale_revision" ? 7 : 8,
            data: {
              actionId: "map.zoomin",
              changed: failure === "specific_result" ? "yes" : true,
            },
            errorCode: null,
            ...(failure === "common_envelope"
              ? { providerDebug: "must-not-pass" }
              : {}),
          },
        }),
      );
    }

    assert.equal(harness.relay.sessions.has(sessionId), false, failure);
  }
});

test("local relay passes the same capability contracts and fixtures to the shared relay", () => {
  const capabilityContracts = [{ capabilityId: "fixture.query" }];
  const tools = [{ type: "function", name: "fixture.query" }];
  const approvedCandidateIds = ["event:fixture"];
  const approvedCandidates = [{ candidateId: "event:fixture" }];
  const repository = { kind: "fixture-repository" };
  const providerConnector = () => {};
  const options = createLocalRelayOptions({
    policy: { schemaVersion: "fixture" },
    repository,
    environment: { OPENAI_API_KEY: "server-only-fixture" },
    providerConnector,
    capabilityContracts,
    tools,
    approvedCandidateIds,
    approvedCandidates,
  });

  assert.equal(options.budgetRepository, repository);
  assert.equal(options.providerConnector, providerConnector);
  assert.equal(options.capabilityContracts, capabilityContracts);
  assert.equal(options.tools, tools);
  assert.equal(options.approvedCandidateIds, approvedCandidateIds);
  assert.equal(options.approvedCandidates, approvedCandidates);
  assert.equal(options.apiKey, "server-only-fixture");
});

test("every terminal reason performs complete idempotent cleanup", () => {
  const terminalFixtures = fixture("terminal-errors.json");

  for (const terminalCase of terminalFixtures.cases) {
    const calls = [];
    const session = {
      state: "speaking",
      providerSocket: { close: () => calls.push("provider-close") },
      browserSocket: { close: () => calls.push("browser-close") },
      abortController: { abort: () => calls.push("abort") },
      pendingConfirmation: { confirmationId: "confirmation-001" },
      pendingDialogue: createPendingDialogue({
        dialogueId: "dialogue-cleanup",
        capabilityId: "event.addtoplan",
        candidates: [
          {
            targetId: "event:one",
            label: "Gallery Night",
            arguments: { eventId: "event:one" },
          },
        ],
        contextRevision: 1,
        nowMs: 1_000,
      }),
      transcriptionReservationId: "transcription-reservation-001",
      transcriptionTimer: setTimeout(() => {}, 60_000),
      finalInputTranscript: "memory-only transcript",
      providerInputItemId: "input-item-memory-only",
      transcriptItems: [{ itemId: "transcript-001", text: "memory-only" }],
      intent: { freeTextSummary: "memory-only" },
      exactLocation: { coordinates: [103.8, 1.3] },
      interfaceContext: { revision: 1 },
    };

    const first = cleanupRelaySession(session, terminalCase.terminal.reason);
    const second = cleanupRelaySession(session, terminalCase.terminal.reason);

    assert.deepEqual(first.terminalEvent, terminalCase.terminal);
    assert.equal(first.state, "stopped");
    assert.deepEqual(first.transcriptItems, []);
    assert.equal(first.intent, null);
    assert.equal(first.exactLocation, null);
    assert.equal(first.interfaceContext, null);
    assert.equal(first.pendingConfirmation, null);
    assert.equal(first.pendingDialogue, null);
    assert.equal(first.transcriptionReservationId, null);
    assert.equal(first.transcriptionTimer, null);
    assert.equal(first.finalInputTranscript, null);
    assert.equal(first.providerInputItemId, null);
    assert.deepEqual(calls, ["abort", "provider-close", "browser-close"]);
    assert.equal(second, first);
  }
});

test("the browser terminal contract uses one provider-independent unavailable message", () => {
  assert.equal(
    VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    "Voice service is currently unavailable. Please try again later.",
  );
  for (const code of [
    "voice_disabled",
    "usage_limit",
    "provider_unavailable",
    "network",
    "admission_failed",
  ])
    assert.doesNotMatch(VOICE_SERVICE_UNAVAILABLE_MESSAGE, new RegExp(code));
});

test("server relay owns provider configuration and reserves before billable events", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const reservations = [];
  const settlements = [];
  const providerMessages = [];
  const browserMessages = [];
  const providerListeners = {};
  const socket = (messages, listeners = {}) => ({
    readyState: 1,
    accept() {},
    close() {},
    send(value) {
      messages.push(JSON.parse(value));
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  });
  const providerSocket = socket(providerMessages, providerListeners);
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
        return value;
      },
      async settle(value) {
        settlements.push(value);
      },
      async hold() {},
    },
    providerConnector: async () => providerSocket,
    randomId: () => `identity-${++identity}`,
    hash: async () => "sha256:fixture",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    openingGreeting: false,
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, socket(browserMessages));
  const acknowledgeLatestConfiguration = async () => {
    const update = providerMessages.findLast(
      ({ type }) => type === "session.update",
    );
    providerListeners.message({
      data: JSON.stringify({
        type: "session.updated",
        session: structuredClone(update.session),
      }),
    });
    await flushRelay();
  };
  await acknowledgeLatestConfiguration();

  assert.equal(providerMessages[0].type, "session.update");
  assert.equal(providerMessages[0].session.model, "gpt-realtime-2.1-mini");
  assert.equal("fallback_model" in providerMessages[0].session, false);
  assert.equal("max_output_tokens" in providerMessages[0].session, false);
  assert.deepEqual(providerMessages[0].session.audio.input.transcription, {
    model: "gpt-realtime-whisper",
  });
  assert.deepEqual(providerMessages[0].session.audio.input.turn_detection, {
    type: "server_vad",
    create_response: false,
    interrupt_response: false,
  });
  assert.deepEqual(
    providerMessages[0].session.tools.map(({ name }) => name),
    [],
  );
  assert.equal(providerMessages[0].session.tool_choice, "none");
  assert.match(
    providerMessages[0].session.instructions,
    /not a general-purpose assistant/i,
  );

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({
      type: "context.update",
      context: {
        revision: 1,
        visibleTargets: [],
        availableCapabilityIds: ["map.zoomin"],
      },
    }),
  );
  await acknowledgeLatestConfiguration();
  const contextualSession = providerMessages
    .filter(({ type }) => type === "session.update")
    .at(-1).session;
  assert.deepEqual(
    contextualSession.tools.map(({ name }) => name),
    [],
  );
  assert.doesNotMatch(contextualSession.instructions, /map\.zoomin/);
  assert.doesNotMatch(contextualSession.instructions, /event\.search/);

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-001" }),
  );
  for (const event of [
    { type: "input_audio_buffer.speech_started", item_id: "input-item-001" },
    { type: "input_audio_buffer.speech_stopped", item_id: "input-item-001" },
    { type: "input_audio_buffer.committed", item_id: "input-item-001" },
  ])
    providerListeners.message({ data: JSON.stringify(event) });
  await flushRelay();

  assert.deepEqual(
    reservations.map(({ kind }) => kind),
    ["response", "input_transcription"],
  );
  assert.equal(
    providerMessages.some(({ type }) => type === "response.create"),
    false,
  );
  assert.equal(
    providerMessages.some(
      ({ type, session }) =>
        type === "session.update" &&
        session.tools.some(({ name }) => name === "voice__classifyrequest"),
    ),
    false,
  );
  assert.equal(
    browserMessages.some(
      (message) =>
        message.type === "turn.ready" && message.turnId === "turn-001",
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(browserMessages),
    /api.?key|server-only-fixture|rateCard/i,
  );

  const providerCompletion = fixture(
    "transcript-provider-events.json",
  ).events.find((event) => event.type === "response.done");
  providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-001",
      transcript: "hello",
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  await acknowledgeLatestConfiguration();
  providerListeners.message({
    data: JSON.stringify({
      type: "response.done",
      response: { usage: providerCompletion.usage },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(relay.sessions.has(admitted.data.sessionId), true);
  assert.equal(
    settlements.some(
      ({ usageShapeHash }) =>
        usageShapeHash === "sha256:provider-final-transcript-max-bound",
    ),
    true,
  );
  assert.equal(settlements.length, 2);
  assert.equal(
    browserMessages.filter(
      (message) =>
        message.type === "session.state" && message.state === "listening",
    ).length,
    2,
  );

  // A duplicate provider transcription completion must be harmless and must
  // not reopen, respond to, or settle the completed turn a second time.
  const responseCreates = providerMessages.filter(
    ({ type }) => type === "response.create",
  ).length;
  providerListeners.message({
    data: JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-001",
      transcript: "",
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(relay.sessions.has(admitted.data.sessionId), true);
  assert.equal(settlements.length, 2);
  assert.equal(
    providerMessages.filter(({ type }) => type === "response.create").length,
    responseCreates,
  );
  assert.equal(
    browserMessages.filter(
      (message) =>
        message.type === "session.state" && message.state === "listening",
    ).length,
    2,
  );

  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "session.stop", reason: "user" }),
  );
  assert.equal(settlements.length, 2);
  assert.deepEqual(
    settlements.map(({ reservationId }) => reservationId).sort(),
    reservations.map(({ reservationId }) => reservationId).sort(),
  );
});

test("server relay rejects overlapping turns without overwriting reservation identity", async () => {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const reservations = [];
  const settlements = [];
  const socket = () => ({
    readyState: 1,
    accept() {},
    close() {},
    send() {},
    addEventListener() {},
  });
  let identity = 0;
  const relay = createRealtimeRelay({
    policy,
    apiKey: "server-only-fixture",
    budgetRepository: {
      async getLedger() {
        return { enabled: true };
      },
      async reserve(value) {
        reservations.push(value);
      },
      async settle(value) {
        settlements.push(value);
      },
      async hold() {},
    },
    providerConnector: async () => socket(),
    randomId: () => `identity-${++identity}`,
    hash: async () => "sha256:fixture",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    openingGreeting: false,
  });
  const admitted = await relay.admit(admission());
  await relay.attach(admitted.data.sessionId, socket());
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-001" }),
  );
  await relay.handleBrowserMessage(
    admitted.data.sessionId,
    JSON.stringify({ type: "turn.request", turnId: "turn-002" }),
  );

  assert.equal(reservations.length, 2);
  assert.equal(relay.sessions.has(admitted.data.sessionId), false);
  assert.deepEqual(
    settlements.map(({ reservationId }) => reservationId).sort(),
    reservations.map(({ reservationId }) => reservationId).sort(),
  );
  assert.equal(
    settlements.every(({ settledMicroUsd }) => settledMicroUsd === 0),
    true,
  );
});

test("discovery tools reject result identities outside the server-approved set", () => {
  const args = {
    result: {
      areas: [
        {
          candidateIds: ["candidate:approved"],
          reasons: [{ candidateIds: ["candidate:approved"] }],
        },
      ],
    },
  };
  assert.deepEqual(
    validateDiscoveryToolArguments(
      "discovery.presentareas",
      args,
      new Set(["candidate:approved"]),
    ),
    args,
  );
  assert.throws(
    () =>
      validateDiscoveryToolArguments(
        "discovery.presentareas",
        {
          result: {
            areas: [{ candidateIds: ["candidate:invented"], reasons: [] }],
          },
        },
        new Set(["candidate:approved"]),
      ),
    TypeError,
  );
});
