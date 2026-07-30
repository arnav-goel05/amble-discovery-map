import {
  cleanupRelaySession,
  sanitizeProviderEvent,
  validateBrowserMessage,
  validateSessionAdmission,
} from "../scripts/lib/realtime-relay-protocol.mjs";
import { createRealtimeContentDebugRecord } from "../scripts/lib/realtime-content-debug.mjs";
import {
  compileSchema,
  createCapabilityResultValidator,
} from "../activity-scenes/assistant/capability-result.js";
import { projectRealtimeFunctionTool } from "../activity-scenes/assistant/protocol-adapters/realtime-function-adapter.js";
import { selectCapabilityTurnScope } from "../activity-scenes/assistant/capability-turn-scope.js";
import { EVENT_APPLY_QUERY_CAPABILITY_CONTRACT } from "../activity-scenes/assistant/connectors/event-connector.js";
import { createPublicActionContracts } from "../activity-scenes/assistant/actions/index.js";
import appInspectResultSchema from "../specs/004-conversational-voice-map/contracts/app-inspect-result.schema.json" with { type: "json" };
import catalogGetResultSchema from "../specs/004-conversational-voice-map/contracts/catalog-get-result.schema.json" with { type: "json" };
import catalogSearchResultSchema from "../specs/004-conversational-voice-map/contracts/catalog-search-result.schema.json" with { type: "json" };

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime";
export const OUT_OF_SCOPE_RESPONSE =
  "I can only help you explore Singapore and use Amble's current features.";
export const AMBLE_WELCOME_MESSAGE =
  "Hi, I'm Amble, your Singapore discovery guide. Tell me what you're in the mood for—I can find events, restaurants, and places, or help you explore the map.";
const VOICE_SERVICE_UNAVAILABLE_MESSAGE =
  "Voice service is currently unavailable. Please try again later.";

export function buildVerbatimSpeechInstructions(text) {
  return [
    "CRITICAL VERBATIM SPEECH TASK.",
    "SPEAK EXACTLY AND ONLY THE TEXT BETWEEN BEGIN EXACT SPEECH AND END EXACT SPEECH.",
    "DO NOT ADD A PREFACE, ACKNOWLEDGEMENT, EXPLANATION, FOLLOW-UP, OR CLOSING.",
    "DO NOT REMOVE, REORDER, REPEAT, SUMMARIZE, TRANSLATE, OR PARAPHRASE ANY WORD.",
    "DO NOT SPEAK THE DELIMITER LABELS.",
    "BEGIN EXACT SPEECH",
    text,
    "END EXACT SPEECH",
    "Before responding, silently verify that the spoken response contains the exact supplied text and nothing else.",
  ].join("\n");
}

const boundedAppInspectResultSchema = structuredClone(appInspectResultSchema);
boundedAppInspectResultSchema.properties.availableCapabilityIds.items.maxLength = 128;
const boundedCatalogSearchResultSchema = structuredClone(
  catalogSearchResultSchema,
);
boundedCatalogSearchResultSchema.properties.types.maxItems = 6;

export function describeAvailableCapabilities(tools = []) {
  return tools.map(({ name, description }) => `${name}: ${description}`);
}

export function buildAmbleSessionInstructions(tools = []) {
  const capabilities = describeAvailableCapabilities(tools);
  return [
    "CRITICAL VERBATIM SPEECH RULES:",
    "- WHEN AN INSTRUCTION SAYS TO SPEAK OR SAY TEXT EXACTLY, OUTPUT EXACTLY AND ONLY THAT TEXT.",
    "- DO NOT ADD A PREFACE, ACKNOWLEDGEMENT, EXPLANATION, FOLLOW-UP, OR CLOSING.",
    "- DO NOT REMOVE, REORDER, REPEAT, SUMMARIZE, TRANSLATE, OR PARAPHRASE ANY WORD.",
    "- THESE VERBATIM RULES OVERRIDE CONVERSATIONAL STYLE OR HELPFULNESS.",
    "You are Amble, the in-application voice guide and controller for this Singapore discovery application. You are not a general-purpose assistant.",
    "Stay strictly within Amble: discover from supplied approved application data, explain currently eligible Amble features, and control the application only through the supplied typed tools.",
    `For unrelated requests or general knowledge, say exactly and only: \"${OUT_OF_SCOPE_RESPONSE}\" Do not answer the unrelated question or add any other text.`,
    "You must not browse or search the open web. Search tools query only approved data already available inside Amble. Never imply that you have unrestricted browser, device, operating-system, or application control.",
    "When asked what you can do, describe only the current eligible capabilities listed below. Group them concisely in user language. Do not mention unavailable, internal, or imagined features.",
    `For the user's opening greeting or a simple hello, say exactly and only: \"${AMBLE_WELCOME_MESSAGE}\" Do not add any other text.`,
    "For every application state change, call an eligible supplied tool. Never claim an action succeeded until its tool result confirms success. If a tool fails, say so and do not pretend the state changed.",
    "Never invent candidate IDs, target IDs, URLs, places, events, prices, availability, routes, locations, attributes, or transport constraints. Use only supplied approved candidates and authoritative interface context.",
    "Ask one focused clarification when a target or required argument is ambiguous. Never self-confirm a consequential action; wait for the application's explicit confirmation flow.",
    "Current eligible capabilities:",
    ...(capabilities.length ? capabilities : ["None currently available."]),
  ].join("\n");
}

const encodeHex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const defaultHash = async (value) =>
  `sha256:${encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))}`;
const defaultId = () => crypto.randomUUID();

export const DISCOVERY_RELAY_TOOLS = Object.freeze([
  Object.freeze({
    type: "function",
    name: "discovery.presentareas",
    description:
      "Present grounded area-first recommendations using only approved candidate identities supplied for this session.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["result"],
      properties: {
        result: {
          type: "object",
          additionalProperties: false,
          required: ["intentRevision", "areas", "clarification"],
          properties: {
            intentRevision: { type: "integer", minimum: 0 },
            areas: { type: "array", maxItems: 5 },
            clarification: { type: ["object", "null"] },
          },
        },
      },
    },
  }),
  Object.freeze({
    type: "function",
    name: "discovery.refine",
    description:
      "Refine the current vague discovery intent without discarding established constraints.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["utterance", "intentRevision"],
      properties: {
        utterance: { type: "string", minLength: 1, maxLength: 500 },
        intentRevision: { type: "integer", minimum: 0 },
      },
    },
  }),
]);

export const FOUNDATIONAL_CAPABILITY_CONTRACTS = Object.freeze([
  Object.freeze({
    capabilityId: "app.inspect",
    version: "2.0",
    kind: "query",
    description:
      "Inspect Amble's current bounded authoritative application state and eligible capabilities.",
    connectorId: "application-state",
    argumentSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    eligibleStates: ["application_initialized"],
    confirmationClass: "none",
    contextProvider: "application-state",
    resultSchema: boundedAppInspectResultSchema,
  }),
  Object.freeze({
    capabilityId: "catalog.search",
    version: "2.0",
    kind: "query",
    description:
      "Search bounded approved Amble catalogue records and return stable application identities.",
    connectorId: "approved-catalog",
    argumentSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", maxLength: 500 },
        types: {
          type: "array",
          maxItems: 6,
          uniqueItems: true,
          items: {
            enum: [
              "area",
              "event",
              "restaurant",
              "plan_stop",
              "saved_item",
              "game",
            ],
          },
        },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        cursor: { type: ["string", "null"], maxLength: 512 },
      },
    },
    eligibleStates: ["approved_catalog_available"],
    confirmationClass: "none",
    contextProvider: "approved-catalog",
    resultSchema: boundedCatalogSearchResultSchema,
  }),
  Object.freeze({
    capabilityId: "catalog.get",
    version: "2.0",
    kind: "query",
    description:
      "Retrieve allowlisted details for up to ten known stable Amble target identities.",
    connectorId: "approved-catalog",
    argumentSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["targetIds"],
      properties: {
        targetIds: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
    eligibleStates: ["approved_catalog_available"],
    confirmationClass: "none",
    contextProvider: "approved-catalog",
    resultSchema: catalogGetResultSchema,
  }),
]);

const CONNECTOR_BY_ACTION_FAMILY = Object.freeze({
  event: "events",
  game: "conditional-content",
  map: "map",
  navigation: "overlay-navigation",
  plan: "plan",
  restaurant: "restaurants",
  saved: "conditional-content",
  tour: "tour",
});

const PUBLIC_ACTION_CAPABILITY_CONTRACTS = Object.freeze(
  createPublicActionContracts({
    dispatch: () => ({ changed: false }),
  })
    .filter(
      ({ actionId }) =>
        !actionId.startsWith("saved.") && !actionId.startsWith("game."),
    )
    .map(
      ({
        actionId,
        description,
        argumentSchema,
        eligibleStates,
        confirmationClass,
        contextProvider,
        resultSchema,
      }) =>
        Object.freeze({
          capabilityId: actionId,
          version: "2.0",
          kind: "command",
          description,
          connectorId:
            CONNECTOR_BY_ACTION_FAMILY[actionId.split(".", 1)[0]] ??
            actionId.split(".", 1)[0],
          argumentSchema,
          eligibleStates,
          confirmationClass,
          contextProvider,
          resultSchema,
        }),
    ),
);

export const DEFAULT_CAPABILITY_CONTRACTS = Object.freeze([
  ...FOUNDATIONAL_CAPABILITY_CONTRACTS,
  EVENT_APPLY_QUERY_CAPABILITY_CONTRACT,
  ...PUBLIC_ACTION_CAPABILITY_CONTRACTS,
]);

const toRelayTool = projectRealtimeFunctionTool;

export const FOUNDATIONAL_RELAY_TOOLS = Object.freeze(
  FOUNDATIONAL_CAPABILITY_CONTRACTS.map(toRelayTool),
);
export const PUBLIC_ACTION_RELAY_TOOLS = Object.freeze(
  PUBLIC_ACTION_CAPABILITY_CONTRACTS.map(toRelayTool),
);
export const DEFAULT_RELAY_TOOLS = Object.freeze(
  DEFAULT_CAPABILITY_CONTRACTS.map(toRelayTool),
);
const FOUNDATIONAL_CAPABILITY_IDS = new Set(
  FOUNDATIONAL_CAPABILITY_CONTRACTS.map(({ capabilityId }) => capabilityId),
);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

export function validateDiscoveryToolArguments(
  actionId,
  argumentsValue,
  approvedCandidateIds,
) {
  if (actionId !== "discovery.presentareas") return argumentsValue;
  const approved =
    approvedCandidateIds instanceof Set
      ? approvedCandidateIds
      : new Set(approvedCandidateIds || []);
  const areas = argumentsValue?.result?.areas;
  if (!Array.isArray(areas)) throw new TypeError("Discovery result is invalid");
  for (const area of areas) {
    const identities = [
      ...(area?.candidateIds || []),
      ...(area?.reasons || []).flatMap((reason) => reason?.candidateIds || []),
    ];
    if (identities.some((candidateId) => !approved.has(candidateId)))
      throw new TypeError("Discovery result contains an unknown candidate");
  }
  return argumentsValue;
}

function validateCloudRelayPolicy(policy) {
  const expected = policy?.worstCaseReservation;
  if (
    policy?.schemaVersion !== "1.1" ||
    policy.owner !== "Arnav" ||
    policy.modelId !== "gpt-realtime-2.1-mini" ||
    policy.transcriptionModelId !== "gpt-realtime-whisper" ||
    policy.capMicroUsd !== 10_000_000 ||
    policy.resetPolicy !== "none" ||
    "maxOutputTokens" in policy ||
    policy.rateCardVersion !== policy.rateCard?.version ||
    expected?.response?.providerMaxOutputTokens !== 4_096 ||
    !Number.isSafeInteger(expected?.inputTranscription?.reservedMicroUsd) ||
    !Number.isSafeInteger(expected?.response?.reservedMicroUsd)
  ) {
    throw new TypeError("Realtime relay policy is invalid");
  }
  return policy;
}

function send(socket, event) {
  if (socket?.readyState === undefined || socket.readyState === 1)
    socket?.send(JSON.stringify(event));
}

function providerSessionUpdate(policy, tools = []) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: policy.modelId,
      instructions: buildAmbleSessionInstructions(tools),
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24_000 },
          transcription: { model: policy.transcriptionModelId },
          turn_detection: null,
        },
        output: {
          format: { type: "audio/pcm", rate: 24_000 },
          voice: "marin",
        },
      },
      tools,
      tool_choice: "auto",
    },
  };
}

function usageCostMicroUsd(usage, policy) {
  if (!usage || typeof usage !== "object") return null;
  const inputAudioTokens = usage.input_token_details?.audio_tokens ?? 0;
  const inputTextTokens =
    usage.input_token_details?.text_tokens ?? usage.input_tokens ?? 0;
  const outputAudioTokens = usage.output_token_details?.audio_tokens ?? 0;
  const outputTextTokens =
    usage.output_token_details?.text_tokens ?? usage.output_tokens ?? 0;
  const fields = [
    inputAudioTokens,
    inputTextTokens,
    outputAudioTokens,
    outputTextTokens,
  ];
  if (fields.some((value) => !Number.isSafeInteger(value) || value < 0))
    return null;
  const rates = policy.rateCard.rates;
  const products = [
    inputAudioTokens * rates.audioInputMicroUsdPerMillionTokens,
    inputTextTokens * rates.textInputMicroUsdPerMillionTokens,
    outputAudioTokens * rates.audioOutputMicroUsdPerMillionTokens,
    outputTextTokens * rates.textOutputMicroUsdPerMillionTokens,
  ];
  if (products.some((value) => !Number.isSafeInteger(value))) return null;
  const total = products.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? Math.ceil(total / 1_000_000) : null;
}

export async function connectOpenAIRealtime({
  apiKey,
  modelId,
  fetchImpl = fetch,
}) {
  if (typeof apiKey !== "string" || !apiKey)
    throw new Error("OpenAI API key is unavailable");
  const response = await fetchImpl(
    `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(modelId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Upgrade: "websocket",
      },
    },
  );
  if (!response.webSocket)
    throw new Error("OpenAI Realtime WebSocket upgrade failed");
  response.webSocket.accept?.();
  return response.webSocket;
}

export function createRealtimeRelay({
  policy,
  budgetRepository,
  apiKey,
  providerConnector = connectOpenAIRealtime,
  fetchImpl = fetch,
  now = () => new Date(),
  randomId = defaultId,
  hash = defaultHash,
  capabilityContracts = DEFAULT_CAPABILITY_CONTRACTS,
  tools = capabilityContracts.map(toRelayTool),
  approvedCandidateIds = [],
  approvedCandidates = [],
  openingGreeting = true,
  operationalLogger = null,
  contentDebugLogger = null,
  responseSetTimeout = setTimeout,
  responseClearTimeout = clearTimeout,
} = {}) {
  validateCloudRelayPolicy(policy);
  if (!budgetRepository || typeof budgetRepository.reserve !== "function")
    throw new TypeError("A voice budget repository is required");
  const reservations = {
    inputTranscriptionMicroUsd:
      policy.worstCaseReservation.inputTranscription.reservedMicroUsd,
    responseMicroUsd: policy.worstCaseReservation.response.reservedMicroUsd,
  };
  const sessions = new Map();
  const contracts = new Map(
    capabilityContracts.map((contract) => [
      contract.capabilityId,
      {
        contract,
        validateArguments: compileSchema(contract.argumentSchema),
        validateResult: createCapabilityResultValidator(contract),
      },
    ]),
  );

  if (
    contracts.size !== capabilityContracts.length ||
    tools.some(({ name }) => !contracts.has(name))
  )
    throw new TypeError("Realtime capability contracts are incomplete");

  const scheduleIdle = (session) => {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => stop(session.sessionId, "idle"),
      policy.idleSeconds * 1_000,
    );
    session.idleTimer?.unref?.();
  };

  const startTurnTrace = (session) => {
    session.turnNumber += 1;
    session.turnTrace = {
      turnNumber: session.turnNumber,
      responseRequestedAtMs: null,
      previousPhaseAtMs: null,
      firstAudioObserved: false,
    };
    return session.turnTrace;
  };

  const tracePhase = (
    session,
    phase,
    { eventCode = phase, terminalReason = null } = {},
  ) => {
    const trace = session.turnTrace || startTurnTrace(session);
    const occurredAt = now();
    const occurredAtMs = occurredAt.getTime();
    if (phase === "response_requested")
      trace.responseRequestedAtMs = occurredAtMs;
    const elapsedMs =
      trace.responseRequestedAtMs === null
        ? 0
        : Math.max(0, occurredAtMs - trace.responseRequestedAtMs);
    const sincePreviousPhaseMs =
      trace.previousPhaseAtMs === null
        ? 0
        : Math.max(0, occurredAtMs - trace.previousPhaseAtMs);
    trace.previousPhaseAtMs = occurredAtMs;
    const record = Object.freeze({
      schemaVersion: "1.0",
      event: "voice.phase",
      sessionIdHash: session.sessionIdHash,
      turnNumber: trace.turnNumber,
      phase,
      occurredAt: occurredAt.toISOString(),
      elapsedMs,
      sincePreviousPhaseMs,
      eventCode,
      terminalReason,
    });
    try {
      operationalLogger?.(record);
    } catch {}
    return record;
  };

  const traceContent = (session, direction, payload) => {
    if (!contentDebugLogger) return;
    try {
      contentDebugLogger(
        createRealtimeContentDebugRecord({
          sessionIdHash: session.sessionIdHash,
          rawSessionId: session.sessionId,
          direction,
          payload,
          occurredAt: now(),
        }),
      );
    } catch {}
  };

  const sendBrowser = (session, event) => {
    traceContent(session, "relay_to_browser", event);
    return send(session.browserSocket, event);
  };

  const sendProvider = (session, event) => {
    traceContent(session, "relay_to_provider", event);
    return send(session.providerSocket, event);
  };

  const clearResponseWatchdog = (session) => {
    if (!session.responseTimer) return false;
    responseClearTimeout(session.responseTimer);
    session.responseTimer = null;
    return true;
  };

  const clearTranscriptionWatchdog = (session) => {
    if (!session.transcriptionTimer) return false;
    responseClearTimeout(session.transcriptionTimer);
    session.transcriptionTimer = null;
    return true;
  };

  const failTranscriptionTurn = (session, phase, eventCode) => {
    if (
      sessions.get(session.sessionId) !== session ||
      session.state === "stopped" ||
      !session.inputReservationId ||
      !session.inputCommitted
    )
      return false;
    clearTranscriptionWatchdog(session);
    tracePhase(session, phase, {
      eventCode,
      terminalReason: "provider",
    });
    sendBrowser(session, {
      type: "error",
      code: "provider_unavailable",
      message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    });
    stop(session.sessionId, "provider");
    return true;
  };

  const startTranscriptionWatchdog = (session) => {
    clearTranscriptionWatchdog(session);
    session.transcriptionTimer = responseSetTimeout(
      () =>
        failTranscriptionTurn(
          session,
          "transcription_timeout",
          "transcription_timeout",
        ),
      policy.responseTimeoutSeconds * 1_000,
    );
    session.transcriptionTimer?.unref?.();
  };

  const sendResponseCreate = (session, response = {}) => {
    if (!session.turnTrace) startTurnTrace(session);
    clearResponseWatchdog(session);
    session.responseCreated = true;
    session.turnTrace.firstAudioObserved = false;
    tracePhase(session, "response_requested");
    session.responseTimer = responseSetTimeout(() => {
      if (
        sessions.get(session.sessionId) !== session ||
        session.state === "stopped" ||
        !session.responseReservationId
      )
        return;
      tracePhase(session, "response_timeout", {
        eventCode: "response_timeout",
        terminalReason: "response_timeout",
      });
      sendBrowser(session, {
        type: "error",
        code: "provider_unavailable",
        message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
      });
      sendProvider(session, { type: "response.cancel" });
      stop(session.sessionId, "response_timeout");
    }, policy.responseTimeoutSeconds * 1_000);
    session.responseTimer?.unref?.();
    return sendProvider(session, {
      type: "response.create",
      response,
    });
  };

  const resumeListeningWhenSettled = (session) => {
    if (
      !session.inputReservationId &&
      !session.responseReservationId &&
      !session.activeReservedTurnId
    )
      sendBrowser(session, {
        type: "session.state",
        state: "listening",
      });
  };

  const scopeToolsForTurn = (session, utterance) => {
    const capabilityFamilies = Object.fromEntries(
      [...contracts.entries()].map(([capabilityId, registered]) => [
        capabilityId,
        registered.contract.connectorId,
      ]),
    );
    const scope = selectCapabilityTurnScope({
      utterance,
      availableCapabilityIds: session.availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: session.interfaceContext?.activeOverlayId ?? null,
      baseContextRevision: session.interfaceContext?.revision ?? 0,
    });
    const available = new Set([
      ...FOUNDATIONAL_CAPABILITY_IDS,
      ...scope.capabilityIds,
    ]);
    session.tools = tools.filter(({ name }) => available.has(name));
    sendProvider(session, providerSessionUpdate(policy, session.tools));
    return scope;
  };

  const createReservedResponse = (session, utterance) => {
    if (!session.responseReservationId || session.responseCreated) return false;
    const scope = scopeToolsForTurn(session, utterance);
    if (scope.deterministicCapabilityId) {
      const registered = contracts.get(scope.deterministicCapabilityId);
      if (!registered) return stop(session.sessionId, "protocol");
      session.pendingDeterministic = {
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        confirmationClass: registered.contract.confirmationClass,
        proposalRevision: session.interfaceContext?.revision ?? 0,
        validateResult: registered.validateResult,
      };
      return true;
    }
    sendResponseCreate(session);
    return true;
  };

  const startOpeningGreeting = async (session) => {
    if (!openingGreeting) {
      sendBrowser(session, {
        type: "session.state",
        state: "listening",
      });
      return true;
    }
    if (session.responseCount >= policy.maxResponses)
      return stop(session.sessionId, "usage_limit");
    try {
      session.responseReservationId = await reserve(
        session,
        "response",
        reservations.responseMicroUsd,
      );
    } catch {
      stop(session.sessionId, "usage_limit");
      return false;
    }
    session.responseCount += 1;
    sendBrowser(session, { type: "session.state", state: "processing" });
    sendProvider(session, {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: buildVerbatimSpeechInstructions(AMBLE_WELCOME_MESSAGE),
          },
        ],
      },
    });
    sendResponseCreate(session, {
      instructions: buildVerbatimSpeechInstructions(AMBLE_WELCOME_MESSAGE),
    });
    return true;
  };

  const stop = (sessionId, reason) => {
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (reason !== "response_timeout" && session.turnTrace)
      tracePhase(session, "session_terminal", {
        eventCode: "session_stopped",
        terminalReason: reason,
      });
    clearTranscriptionWatchdog(session);
    clearResponseWatchdog(session);
    sendBrowser(session, { type: "session.stopped", reason });
    for (const reservationId of session.openReservations) {
      const mustHold =
        reservationId === session.responseReservationId
          ? session.responseCreated
          : reservationId === session.inputReservationId
            ? session.inputCommitted
            : true;
      const conservativeUserSettlement = mustHold && reason === "user";
      const operation = conservativeUserSettlement
        ? budgetRepository.settle({
            reservationId,
            settledMicroUsd:
              reservationId === session.responseReservationId
                ? reservations.responseMicroUsd
                : reservations.inputTranscriptionMicroUsd,
            usageShapeHash: "sha256:conservative-user-stop",
            settledAt: now().toISOString(),
          })
        : mustHold
          ? budgetRepository.hold({
              reservationId,
              reason: "terminal_without_trusted_usage",
              heldAt: now().toISOString(),
            })
          : budgetRepository.settle({
              reservationId,
              settledMicroUsd: 0,
              usageShapeHash: "sha256:no-billable-event",
              settledAt: now().toISOString(),
            });
      void Promise.resolve(operation).catch(() => {});
    }
    cleanupRelaySession(session, reason);
    sessions.delete(sessionId);
    return session;
  };

  const reserve = async (session, kind, requestedMicroUsd) => {
    const reservationId = randomId();
    await budgetRepository.reserve({
      reservationId,
      sessionIdHash: session.sessionIdHash,
      kind,
      requestedMicroUsd,
      rateCardVersion: policy.rateCardVersion,
      createdAt: now().toISOString(),
    });
    session.openReservations.push(reservationId);
    return reservationId;
  };

  const hold = async (session, reservationId, reason) => {
    await budgetRepository.hold({
      reservationId,
      reason,
      heldAt: now().toISOString(),
    });
    stop(session.sessionId, "usage_limit");
  };

  const settleInputReservation = async (
    session,
    usageShapeHash = "sha256:fixed-transcription-reservation",
  ) => {
    const reservationId = session.inputReservationId;
    if (!reservationId) return true;
    try {
      await budgetRepository.settle({
        reservationId,
        settledMicroUsd: reservations.inputTranscriptionMicroUsd,
        usageShapeHash,
        settledAt: now().toISOString(),
      });
      session.openReservations = session.openReservations.filter(
        (id) => id !== reservationId,
      );
      session.inputReservationId = null;
      session.inputCommitted = false;
      return true;
    } catch {
      await hold(session, reservationId, "transcription_settlement_failure");
      return false;
    }
  };

  const completeCapabilityCall = async (session, pendingCall) => {
    if (!session.responseReservationId) {
      if (session.responseCount >= policy.maxResponses)
        return stop(session.sessionId, "usage_limit");
      try {
        session.responseReservationId = await reserve(
          session,
          "response",
          reservations.responseMicroUsd,
        );
      } catch {
        return stop(session.sessionId, "usage_limit");
      }
      session.responseCount += 1;
      session.responseCreated = true;
    }
    session.pendingCalls.delete(pendingCall.callId);
    session.pendingCallIds.delete(pendingCall.callId);
    session.terminalCalls.set(pendingCall.callId, {
      ...pendingCall,
      result: structuredClone(pendingCall.result),
    });
    sendProvider(session, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: pendingCall.callId,
        output: JSON.stringify(pendingCall.result),
      },
    });
    sendBrowser(session, {
      type: "capability.completed",
      callId: pendingCall.callId,
      capabilityId: pendingCall.capabilityId,
      kind: pendingCall.kind,
      result: pendingCall.result,
    });
    sendResponseCreate(session);
  };

  const onProviderEvent = async (session, rawEvent) => {
    if (
      session.state === "stopped" ||
      sessions.get(session.sessionId) !== session
    )
      return;
    let event;
    try {
      event = typeof rawEvent === "string" ? JSON.parse(rawEvent) : rawEvent;
    } catch {
      return stop(session.sessionId, "protocol");
    }
    traceContent(session, "provider_to_relay", event);
    session.lastProviderEventType = event.type;
    if (event.type === "response.created") {
      tracePhase(session, "response_created");
      sendBrowser(session, {
        type: "session.state",
        state: "processing",
      });
    }
    if (
      event.type === "response.output_audio.delta" &&
      !session.turnTrace?.firstAudioObserved
    ) {
      session.turnTrace.firstAudioObserved = true;
      tracePhase(session, "first_audio");
    }
    if (event.type === "response.output_audio.delta")
      sendBrowser(session, { type: "session.state", state: "speaking" });
    if (event.type === "response.function_call_arguments.done") {
      const tool = session.tools.find(
        (candidate) => candidate.name === event.name,
      );
      const registered = contracts.get(event.name);
      if (
        !tool ||
        !registered ||
        typeof event.call_id !== "string" ||
        !event.call_id ||
        event.call_id.length > 128
      )
        return stop(session.sessionId, "protocol");
      let argumentsValue;
      try {
        argumentsValue = JSON.parse(event.arguments || "{}");
      } catch {
        return stop(session.sessionId, "protocol");
      }
      if (
        !argumentsValue ||
        typeof argumentsValue !== "object" ||
        Array.isArray(argumentsValue)
      )
        return stop(session.sessionId, "protocol");
      if (!registered.validateArguments(argumentsValue).valid)
        return stop(session.sessionId, "protocol");
      try {
        validateDiscoveryToolArguments(
          event.name,
          argumentsValue,
          session.approvedCandidateIds,
        );
      } catch {
        return stop(session.sessionId, "protocol");
      }
      const argumentsKey = canonical(argumentsValue);
      const terminalCall = session.terminalCalls.get(event.call_id);
      if (terminalCall) {
        if (
          terminalCall.capabilityId !== registered.contract.capabilityId ||
          terminalCall.argumentsKey !== argumentsKey ||
          !session.responseReservationId
        )
          return stop(session.sessionId, "protocol");
        sendProvider(session, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: terminalCall.callId,
            output: JSON.stringify(terminalCall.result),
          },
        });
        return sendResponseCreate(session);
      }
      if (session.pendingCalls.size >= 1)
        return stop(session.sessionId, "protocol");
      session.pendingCallIds.add(event.call_id);
      session.pendingCalls.set(event.call_id, {
        callId: event.call_id,
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        confirmationClass: registered.contract.confirmationClass,
        argumentsKey,
        proposalRevision: session.interfaceContext?.revision ?? 0,
        validateResult: registered.validateResult,
        result: null,
      });
      sendBrowser(session, {
        type: "capability.proposed",
        callId: event.call_id,
        capabilityId: event.name,
        kind: registered.contract.kind,
        arguments: argumentsValue,
        contextRevision: session.interfaceContext?.revision ?? 0,
      });
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      session.inputReservationId
    ) {
      clearTranscriptionWatchdog(session);
      tracePhase(session, "transcription_completed");
      const sanitized = sanitizeProviderEvent(event);
      const settled = await settleInputReservation(
        session,
        event.usage && typeof event.usage === "object"
          ? await hash(JSON.stringify(Object.keys(event.usage).sort()))
          : "sha256:fixed-transcription-reservation",
      );
      if (!settled) return;
      createReservedResponse(
        session,
        typeof event.transcript === "string" ? event.transcript : "",
      );
      if (sanitized?.browserEvent) sendBrowser(session, sanitized.browserEvent);
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.failed" &&
      session.inputReservationId
    ) {
      failTranscriptionTurn(
        session,
        "transcription_failed",
        "transcription_failed",
      );
      return;
    }
    const sanitized = sanitizeProviderEvent(event);
    if (!sanitized) return;
    if (event.type === "response.done") {
      clearResponseWatchdog(session);
      tracePhase(session, "response_done");
    }
    if (sanitized.browserEvent) sendBrowser(session, sanitized.browserEvent);
    if (
      event.type === "response.done" &&
      session.responseReservationId &&
      !sanitized.trustedUsage
    )
      return hold(
        session,
        session.responseReservationId,
        "missing_response_usage",
      );
    if (sanitized.trustedUsage && session.responseReservationId) {
      const reservationId = session.responseReservationId;
      const cost = usageCostMicroUsd(sanitized.trustedUsage, policy);
      if (cost === null) return hold(session, reservationId, "untrusted_usage");
      const usageShapeHash = await hash(
        JSON.stringify({ ...sanitized.trustedUsage, values: undefined }),
      );
      try {
        await budgetRepository.settle({
          reservationId,
          settledMicroUsd: cost,
          usageShapeHash,
          settledAt: now().toISOString(),
        });
        session.openReservations = session.openReservations.filter(
          (id) => id !== reservationId,
        );
        session.responseReservationId = null;
        session.responseCreated = false;
        if (session.inputReservationId) {
          const inputSettled = await settleInputReservation(
            session,
            "sha256:fixed-transcription-on-response-complete",
          );
          if (!inputSettled) return;
        }
        resumeListeningWhenSettled(session);
      } catch {
        await hold(session, reservationId, "settlement_failure");
      }
    }
  };

  const attach = async (sessionId, browserSocket) => {
    const session = sessions.get(sessionId);
    if (
      !session ||
      session.browserSocket ||
      now().getTime() >= session.expiresAt.getTime()
    )
      throw new Error("Voice session is unavailable");
    session.browserSocket = browserSocket;
    browserSocket.accept?.();
    try {
      session.providerSocket = await providerConnector({
        apiKey,
        modelId: policy.modelId,
        fetchImpl,
      });
      sendProvider(session, providerSessionUpdate(policy, session.tools));
      if (session.approvedCandidates.length)
        sendProvider(session, {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `Approved discovery candidates (use only these identities and attributes): ${JSON.stringify(session.approvedCandidates)}`,
              },
            ],
          },
        });
    } catch {
      stop(sessionId, "provider");
      throw new Error("Voice provider is unavailable");
    }
    session.providerSocket.addEventListener?.("message", (event) => {
      session.providerEventQueue = session.providerEventQueue
        .then(() => onProviderEvent(session, event.data))
        .catch(() => stop(sessionId, "protocol"));
    });
    session.providerSocket.addEventListener?.("close", () =>
      stop(sessionId, "network"),
    );
    browserSocket.addEventListener?.("message", (event) => {
      if (session.state === "stopped") return;
      session.browserEventQueue = session.browserEventQueue
        .then(() => handleBrowserMessage(sessionId, event.data))
        .catch(() => stop(sessionId, "protocol"));
    });
    browserSocket.addEventListener?.("close", () => stop(sessionId, "network"));
    scheduleIdle(session);
    await startOpeningGreeting(session);
    return session;
  };

  const handleBrowserMessage = async (sessionId, rawMessage) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Voice session is unavailable");
    const currentTime = now();
    if (currentTime.getTime() >= session.expiresAt.getTime())
      return stop(sessionId, "duration");
    if (
      currentTime.getTime() - session.lastActivityAt.getTime() >=
      policy.idleSeconds * 1_000
    )
      return stop(sessionId, "idle");
    let parsed;
    try {
      parsed =
        typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
    } catch {
      return stop(sessionId, "protocol");
    }
    traceContent(session, "browser_to_relay", parsed);
    let message;
    try {
      message = validateBrowserMessage(parsed, {
        activeReservedTurnId: session.activeReservedTurnId,
        pendingCallIds: session.pendingCallIds,
        pendingCalls: session.pendingCalls,
        pendingConfirmation: session.pendingConfirmation,
        pendingDeterministic: session.pendingDeterministic,
        maxMessageBytes: 16 * 1024,
        maxAudioChunkBytes: 12 * 1024,
        maxTextChars: 2_000,
        validateCapabilityResult: (candidate, pendingCall) =>
          pendingCall.validateResult(candidate.result, {
            proposalRevision: pendingCall.proposalRevision,
          }),
      });
    } catch {
      return stop(sessionId, "protocol");
    }
    session.lastActivityAt = now();
    session.lastBrowserMessageType = message.type;
    scheduleIdle(session);
    if (message.type === "session.stop") return stop(sessionId, "user");
    if (message.type === "turn.request") {
      if (
        session.activeReservedTurnId ||
        session.inputReservationId ||
        session.responseReservationId
      )
        return stop(sessionId, "protocol");
      if (session.responseCount >= policy.maxResponses)
        return stop(sessionId, "usage_limit");
      try {
        session.inputReservationId = await reserve(
          session,
          "input_transcription",
          reservations.inputTranscriptionMicroUsd,
        );
      } catch {
        return stop(sessionId, "usage_limit");
      }
      session.activeReservedTurnId = message.turnId;
      return sendBrowser(session, {
        type: "turn.ready",
        turnId: message.turnId,
      });
    }
    if (message.type === "audio.append")
      return sendProvider(session, {
        type: "input_audio_buffer.append",
        audio: message.audio,
      });
    if (message.type === "audio.commit") {
      startTurnTrace(session);
      tracePhase(session, "audio_committed");
      session.activeReservedTurnId = null;
      try {
        session.responseReservationId = await reserve(
          session,
          "response",
          reservations.responseMicroUsd,
        );
      } catch {
        return stop(sessionId, "usage_limit");
      }
      session.responseCount += 1;
      session.responseCreated = false;
      session.inputCommitted = true;
      startTranscriptionWatchdog(session);
      sendProvider(session, { type: "input_audio_buffer.commit" });
      return;
    }
    if (message.type === "text.submit") {
      if (
        session.activeReservedTurnId ||
        session.inputReservationId ||
        session.responseReservationId
      )
        return stop(sessionId, "protocol");
      if (session.responseCount >= policy.maxResponses)
        return stop(sessionId, "usage_limit");
      startTurnTrace(session);
      try {
        session.responseReservationId = await reserve(
          session,
          "response",
          reservations.responseMicroUsd,
        );
      } catch {
        return stop(sessionId, "usage_limit");
      }
      session.responseCount += 1;
      session.responseCreated = false;
      sendProvider(session, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: message.text }],
        },
      });
      return createReservedResponse(session, message.text);
    }
    if (message.type === "capability.result") {
      const pendingCall = session.pendingCalls.get(message.callId);
      pendingCall.result = structuredClone(message.result);
      const requiresRefresh =
        message.kind === "command" &&
        message.result.status === "completed" &&
        message.result.changed === true;
      if (
        requiresRefresh &&
        (session.interfaceContext?.revision ?? -1) <
          message.result.contextRevision
      )
        return;
      return completeCapabilityCall(session, pendingCall);
    }
    if (message.type === "confirmation.pending") {
      session.pendingConfirmation = {
        callId: message.callId,
        confirmationId: message.confirmationId,
        fingerprint: message.fingerprint,
      };
      return sendBrowser(session, {
        type: "confirmation.required",
        callId: message.callId,
        confirmationId: message.confirmationId,
        fingerprint: message.fingerprint,
        targetId: message.targetId ?? null,
        effectSummary: message.effectSummary,
        expiresAt: message.expiresAt,
      });
    }
    if (message.type === "confirmation.result")
      session.pendingConfirmation = null;
    if (message.type === "deterministic.result") {
      session.pendingDeterministic = null;
      sendProvider(session, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `The deterministic application capability ${message.capabilityId} completed with this authoritative result: ${JSON.stringify(message.result)}. Briefly describe that verified outcome without calling the capability again.`,
            },
          ],
        },
      });
      return sendResponseCreate(session);
    }
    if (message.type === "response.cancel") {
      clearResponseWatchdog(session);
      return sendProvider(session, { type: "response.cancel" });
    }
    if (message.type === "context.update") {
      if (
        session.interfaceContext &&
        message.context.revision < session.interfaceContext.revision
      )
        return stop(sessionId, "protocol");
      session.interfaceContext = structuredClone(message.context);
      session.availableCapabilityIds = [
        ...(message.context.availableCapabilityIds || []),
      ];
      if (!session.responseCreated) {
        session.tools = tools.filter(({ name }) =>
          FOUNDATIONAL_CAPABILITY_IDS.has(name),
        );
        sendProvider(session, providerSessionUpdate(policy, session.tools));
      }
      sendProvider(session, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Current application context (authoritative for references): ${JSON.stringify(message.context)}`,
            },
          ],
        },
      });
      const pendingCall = [...session.pendingCalls.values()].find(
        (candidate) =>
          candidate.result?.changed === true &&
          message.context.revision >= candidate.result.contextRevision,
      );
      if (pendingCall) await completeCapabilityCall(session, pendingCall);
      return;
    }
  };

  const admit = async (admission) => {
    const ledger = await budgetRepository.getLedger();
    const validated = validateSessionAdmission({
      ...admission,
      runtimeEnabled: ledger.enabled,
    });
    const sessionId = randomId();
    const createdAt = now();
    const session = {
      sessionId,
      sessionIdHash: await hash(sessionId),
      state: "connecting",
      createdAt,
      lastActivityAt: createdAt,
      expiresAt: new Date(
        createdAt.getTime() + policy.maxSessionSeconds * 1_000,
      ),
      responseCount: 0,
      activeReservedTurnId: null,
      responseReservationId: null,
      inputReservationId: null,
      inputCommitted: false,
      responseCreated: false,
      transcriptionTimer: null,
      responseTimer: null,
      turnNumber: 0,
      turnTrace: null,
      openReservations: [],
      pendingCallIds: new Set(),
      pendingCalls: new Map(),
      terminalCalls: new Map(),
      approvedCandidateIds: new Set(approvedCandidateIds),
      approvedCandidates: structuredClone(approvedCandidates),
      availableCapabilityIds: [],
      tools: tools.filter(({ name }) => FOUNDATIONAL_CAPABILITY_IDS.has(name)),
      pendingConfirmation: null,
      pendingDeterministic: null,
      transcriptItems: [],
      intent: null,
      exactLocation: null,
      interfaceContext: null,
      browserSocket: null,
      providerSocket: null,
      abortController: new AbortController(),
      idleTimer: null,
      durationTimer: null,
      providerEventQueue: Promise.resolve(),
      browserEventQueue: Promise.resolve(),
    };
    session.durationTimer = setTimeout(
      () => stop(sessionId, "duration"),
      policy.maxSessionSeconds * 1_000,
    );
    session.durationTimer?.unref?.();
    sessions.set(sessionId, session);
    return {
      ok: true,
      data: {
        sessionId,
        protocolVersion: validated.protocolVersion,
        streamPath: `/api/voice/sessions/${encodeURIComponent(sessionId)}/stream`,
        expiresAt: session.expiresAt.toISOString(),
        limits: {
          maxSessionSeconds: policy.maxSessionSeconds,
          idleSeconds: policy.idleSeconds,
          maxResponses: policy.maxResponses,
          responseTimeoutSeconds: policy.responseTimeoutSeconds,
        },
      },
    };
  };

  const setApprovedCandidateIds = (sessionId, candidateIds) => {
    const session = sessions.get(sessionId);
    if (
      !session ||
      !Array.isArray(candidateIds) ||
      candidateIds.some((id) => typeof id !== "string" || !id)
    )
      throw new TypeError("Approved candidate identities are invalid");
    session.approvedCandidateIds = new Set(candidateIds);
  };

  const setAvailableCapabilityIds = (sessionId, capabilityIds) => {
    const session = sessions.get(sessionId);
    if (
      !session ||
      !Array.isArray(capabilityIds) ||
      capabilityIds.some((id) => typeof id !== "string" || !id)
    )
      throw new TypeError("Available capability identities are invalid");
    const available = new Set([
      ...FOUNDATIONAL_CAPABILITY_IDS,
      ...capabilityIds,
    ]);
    session.availableCapabilityIds = [...available].filter(
      (name) => !FOUNDATIONAL_CAPABILITY_IDS.has(name),
    );
    session.tools = tools.filter(({ name }) =>
      FOUNDATIONAL_CAPABILITY_IDS.has(name),
    );
    if (session.providerSocket)
      sendProvider(session, providerSessionUpdate(policy, session.tools));
    return session.tools.map(({ name }) => name);
  };

  return Object.freeze({
    admit,
    attach,
    handleBrowserMessage,
    setApprovedCandidateIds,
    setAvailableActionIds: setAvailableCapabilityIds,
    setAvailableCapabilityIds,
    stop,
    sessions,
  });
}
