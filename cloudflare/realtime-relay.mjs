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
import {
  createProviderCapabilityAliasMap,
  projectRealtimeFunctionTool,
} from "../activity-scenes/assistant/protocol-adapters/realtime-function-adapter.js";
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
const VOICE_INGRESS_TOOL_NAME = "voice__classifyrequest";
const NO_TOOL_CHOICE = "none";
const AUTO_TOOL_CHOICE = "auto";
const TOOL_STAGE_RESPONSE_INSTRUCTIONS =
  "If an application tool is needed, call it immediately with no spoken or written commentary before or after the call. If no tool is needed, answer the user directly and concisely.";
const BUFFERED_PROVIDER_OUTPUT_LIMIT = 2 * 1_024 * 1_024;
const ASSISTANT_OUTPUT_EVENT_TYPES = new Set([
  "assistant.audio.delta",
  "assistant.audio.done",
  "assistant.text.delta",
  "assistant.text.done",
]);
const VOICE_INGRESS_TOOL_CHOICE = Object.freeze({
  type: "function",
  name: VOICE_INGRESS_TOOL_NAME,
});
export const VOICE_INGRESS_TOOL = Object.freeze({
  type: "function",
  name: VOICE_INGRESS_TOOL_NAME,
  description:
    "Classify the latest committed user audio for Amble routing without returning a transcript.",
  parameters: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["domain", "eventQuery"],
    properties: Object.freeze({
      domain: Object.freeze({ enum: ["event", "other", "ambiguous"] }),
      eventQuery: Object.freeze({ type: "null" }),
    }),
  }),
});

export function createVoiceIngressTool(eventFacetCatalog = null) {
  const selection = (labels) => ({
    type: "object",
    additionalProperties: false,
    required: ["label", "evidence"],
    properties: {
      label: labels.length
        ? { type: "string", enum: labels }
        : { type: "string", minLength: 1, maxLength: 160 },
      evidence: { type: "string", minLength: 1, maxLength: 160 },
    },
  });
  const labelsFor = (facet) =>
    Array.isArray(eventFacetCatalog?.[facet])
      ? eventFacetCatalog[facet].slice(0, facet === "what" ? 60 : 20)
      : [];
  const eventQuery = {
    type: "object",
    additionalProperties: false,
    required: ["what", "when", "where", "price", "residualQuery", "unresolved"],
    properties: {
      what: {
        type: "array",
        maxItems: 6,
        uniqueItems: true,
        items: selection(labelsFor("what")),
      },
      ...Object.fromEntries(
        ["when", "where", "price"].map((facet) => [
          facet,
          {
            anyOf: [selection(labelsFor(facet)), { type: "null" }],
          },
        ]),
      ),
      residualQuery: { type: "string", maxLength: 200 },
      unresolved: {
        type: "array",
        maxItems: 4,
        uniqueItems: true,
        items: { enum: ["what", "when", "where", "price"] },
      },
    },
  };
  return Object.freeze({
    ...VOICE_INGRESS_TOOL,
    description:
      "Classify the latest committed user audio without returning or reconstructing a transcript. Return exactly domain and eventQuery. For an event request, bind only constraints explicitly heard to current labels: generic words such as event or events are not a What category. What is always an array; When, Where, and Price are each one object or null, never arrays. Evidence must be an exact phrase heard in the request that actually names the selected label. Omitted optional facets are null and must not be unresolved. Mark a facet unresolved only when the request expresses two or more materially plausible values. Put only meaningful unbound search terms in eventQuery.residualQuery.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["domain", "eventQuery"],
      properties: {
        domain: { enum: ["event", "other", "ambiguous"] },
        eventQuery: { anyOf: [eventQuery, { type: "null" }] },
      },
    },
  });
}

const INGRESS_ROOT_FIELDS = new Set([
  "domain",
  "eventQuery",
  "what",
  "when",
  "where",
  "price",
  "residualQuery",
  "unresolved",
]);
const INGRESS_EVENT_FIELD_ALIASES = Object.freeze({
  eventWhat: "what",
  eventWhen: "when",
  eventWhere: "where",
  eventPrice: "price",
  eventResidualQuery: "residualQuery",
  eventUnresolved: "unresolved",
});
const EVENT_QUERY_FIELDS = new Set([
  "what",
  "when",
  "where",
  "price",
  "residualQuery",
  "unresolved",
]);

const sameCanonicalValue = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
const isBoundedUnusedEventQuery = (value) =>
  value === null ||
  (value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => EVENT_QUERY_FIELDS.has(key)) &&
    JSON.stringify(value).length <= 4_096);

export function canonicalizeVoiceIngress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    Object.keys(value).some(
      (key) =>
        !INGRESS_ROOT_FIELDS.has(key) && !(key in INGRESS_EVENT_FIELD_ALIASES),
    )
  )
    return null;
  value = structuredClone(value);
  for (const [alias, field] of Object.entries(INGRESS_EVENT_FIELD_ALIASES)) {
    if (value[alias] === undefined) continue;
    if (
      value[field] !== undefined &&
      !sameCanonicalValue(value[field], value[alias])
    )
      return null;
    value[field] = value[alias];
    delete value[alias];
  }
  if (value.domain === undefined) return null;
  if (!["event", "other", "ambiguous"].includes(value.domain)) return null;

  if (value.domain !== "event") {
    if (!isBoundedUnusedEventQuery(value.eventQuery)) return null;
    if (
      (value.what != null &&
        (!Array.isArray(value.what) || value.what.length > 6)) ||
      ["when", "where", "price"].some(
        (facet) =>
          value[facet] !== undefined &&
          JSON.stringify(value[facet]).length > 1_024,
      )
    )
      return null;
    if (
      value.unresolved != null &&
      (!Array.isArray(value.unresolved) || value.unresolved.length > 4)
    )
      return null;
    if (
      value.residualQuery != null &&
      (typeof value.residualQuery !== "string" ||
        value.residualQuery.length > 200)
    )
      return null;
    return {
      domain: value.domain,
      eventQuery: null,
    };
  }

  if (
    !value.eventQuery ||
    typeof value.eventQuery !== "object" ||
    Array.isArray(value.eventQuery) ||
    Object.keys(value.eventQuery).some((key) => !EVENT_QUERY_FIELDS.has(key))
  )
    return { domain: value.domain, eventQuery: null };
  const eventQuery = structuredClone(value.eventQuery);
  for (const field of [
    "what",
    "when",
    "where",
    "price",
    "residualQuery",
    "unresolved",
  ]) {
    if (value[field] === undefined) continue;
    if (
      eventQuery[field] !== undefined &&
      !sameCanonicalValue(eventQuery[field], value[field])
    )
      return null;
    eventQuery[field] = structuredClone(value[field]);
  }
  eventQuery.what ??= [];
  eventQuery.when ??= null;
  eventQuery.where ??= null;
  eventQuery.price ??= null;
  eventQuery.residualQuery ??= "";
  eventQuery.unresolved ??= [];
  for (const facet of ["when", "where", "price"]) {
    if (!Array.isArray(eventQuery[facet])) continue;
    if (eventQuery[facet].length > 1) return null;
    eventQuery[facet] = eventQuery[facet][0] ?? null;
  }
  if (
    !Array.isArray(eventQuery.what) ||
    eventQuery.what.length > 6 ||
    !eventQuery.what.every(
      (selection) =>
        selection &&
        typeof selection === "object" &&
        !Array.isArray(selection) &&
        typeof selection.label === "string" &&
        selection.label.length > 0 &&
        selection.label.length <= 160 &&
        typeof selection.evidence === "string" &&
        selection.evidence.length > 0 &&
        selection.evidence.length <= 160,
    ) ||
    !["when", "where", "price"].every(
      (facet) =>
        eventQuery[facet] === null ||
        (eventQuery[facet] &&
          typeof eventQuery[facet] === "object" &&
          !Array.isArray(eventQuery[facet]) &&
          typeof eventQuery[facet].label === "string" &&
          eventQuery[facet].label.length > 0 &&
          eventQuery[facet].label.length <= 160 &&
          typeof eventQuery[facet].evidence === "string" &&
          eventQuery[facet].evidence.length > 0 &&
          eventQuery[facet].evidence.length <= 160),
    ) ||
    typeof eventQuery.residualQuery !== "string" ||
    eventQuery.residualQuery.length > 200 ||
    !Array.isArray(eventQuery.unresolved) ||
    eventQuery.unresolved.length > 4
  )
    return { domain: value.domain, eventQuery: null };
  return {
    domain: value.domain,
    eventQuery,
  };
}

export function selectVoiceEventQueryMode(utterance, composerState) {
  const hasExistingQuery =
    (Array.isArray(composerState?.filterTokens) &&
      composerState.filterTokens.length > 0) ||
    Boolean(String(composerState?.residualQuery ?? "").trim());
  if (!hasExistingQuery) return "replace";
  return /\b(?:add|also|change|instead|make|remove|switch|them|those)\b/i.test(
    String(utterance ?? ""),
  )
    ? "refine"
    : "replace";
}

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

export function buildVoiceIngressResponseInstructions() {
  return [
    "INGRESS CLASSIFICATION TASK ONLY.",
    "Do not answer, acknowledge, refuse, summarize, or act on the user's request in this response.",
    "Call voice__classifyrequest exactly once.",
    "Return only domain and eventQuery; never return, reconstruct, or paraphrase a transcript.",
    "Classify and structure only constraints present in the latest committed user audio.",
    "Emit no spoken or written commentary before or after the function call.",
  ].join("\n");
}

export function capabilityResultSpeech(
  capabilityId,
  argumentsValue = {},
  result = {},
) {
  if (result.status !== "completed")
    return "I couldn't complete that in Amble.";
  if (capabilityId === "event.applyquery") {
    if (result.data?.outcome === "clarification_required") {
      const labels = (result.data.clarificationChoices ?? [])
        .map(({ label }) => label)
        .filter(Boolean)
        .slice(0, 4);
      return labels.length
        ? `Which did you mean: ${labels.join(" or ")}?`
        : "Which event option did you mean?";
    }
    const count = result.data?.resultCount;
    if (Number.isInteger(count))
      return `I found ${count} matching event${count === 1 ? "" : "s"}.`;
    return "I updated the event results.";
  }
  if (capabilityId === "restaurant.search") {
    const query = String(argumentsValue.query ?? "")
      .trim()
      .replace(/[.!?]+$/g, "");
    return query
      ? `I updated the restaurant results for ${query}.`
      : "I updated the restaurant results.";
  }
  if (capabilityId === "map.zoomin") return "I zoomed in on the map.";
  if (capabilityId === "map.zoomout") return "I zoomed out on the map.";
  if (capabilityId === "map.setlayervisibility") {
    const layerLabels = {
      mrtLines: "train lines",
      mrtStations: "train stations",
      location: "your location",
      recommendations: "recommendations",
    };
    const label =
      layerLabels[argumentsValue.layer] ?? "the requested map layer";
    return `I ${argumentsValue.visible === false ? "hid" : "showed"} ${label}.`;
  }
  if (result.changed === false) return "That is already set in Amble.";
  return "Done in Amble.";
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
    "maxSessionSeconds" in policy ||
    "idleSeconds" in policy ||
    "maxResponses" in policy ||
    policy.maxResponseStagesPerTurn !== 3 ||
    policy.rateCardVersion !== policy.rateCard?.version ||
    policy.rateCard?.rates?.transcriptionMicroUsdPerMinute !== 17_000 ||
    expected?.inputTranscription?.maxAudioSeconds !== 60 ||
    expected?.inputTranscription?.reservedMicroUsd !== 17_000 ||
    expected?.response?.providerMaxOutputTokens !== 4_096 ||
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

function providerSessionUpdate(
  policy,
  tools = [],
  providerToCanonical = null,
  toolChoice = AUTO_TOOL_CHOICE,
) {
  const instructionTools = tools.map((tool) => ({
    ...tool,
    name: providerToCanonical?.get(tool.name) ?? tool.name,
  }));
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: policy.modelId,
      instructions: buildAmbleSessionInstructions(instructionTools),
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
      tool_choice: toolChoice,
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
  configurationSetTimeout = setTimeout,
  configurationClearTimeout = clearTimeout,
} = {}) {
  validateCloudRelayPolicy(policy);
  if (!budgetRepository || typeof budgetRepository.reserve !== "function")
    throw new TypeError("A voice budget repository is required");
  const reservations = {
    responseMicroUsd: policy.worstCaseReservation.response.reservedMicroUsd,
    transcriptionMicroUsd:
      policy.worstCaseReservation.inputTranscription.reservedMicroUsd,
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
  const capabilityAliases = createProviderCapabilityAliasMap([
    ...contracts.keys(),
  ]);
  const { providerToCanonical } = capabilityAliases;

  if (
    contracts.size !== capabilityContracts.length ||
    tools.length !== contracts.size ||
    new Set(tools.map(({ name }) => name)).size !== tools.length ||
    tools.some(({ name }) => !providerToCanonical.has(name))
  )
    throw new TypeError("Realtime capability contracts are incomplete");

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

  const discardBufferedProviderOutput = (session) => {
    session.bufferedProviderOutput = null;
    session.bufferedProviderOutputBytes = 0;
  };

  const flushBufferedProviderOutput = (session) => {
    const buffered = session.bufferedProviderOutput;
    discardBufferedProviderOutput(session);
    if (!Array.isArray(buffered) || !buffered.length) return false;
    sendBrowser(session, { type: "session.state", state: "speaking" });
    for (const browserEvent of buffered) sendBrowser(session, browserEvent);
    return true;
  };

  const bufferedProviderTranscript = (session) =>
    (session.bufferedProviderOutput ?? [])
      .filter(({ type }) => type === "assistant.text.done")
      .map(({ text }) => String(text ?? "").trim())
      .filter(Boolean)
      .join("\n");

  const prepareExpectedSpeech = (
    session,
    expectedSpeech,
    { retry = false } = {},
  ) => {
    session.expectedSpeech = expectedSpeech;
    if (!retry) session.expectedSpeechRetryCount = 0;
    session.bufferedProviderOutput = [];
    session.bufferedProviderOutputBytes = 0;
  };

  const appendPendingIngressOutput = (session) => {
    if (!session.pendingIngressCallId) return false;
    const callId = session.pendingIngressCallId;
    session.pendingIngressCallId = null;
    sendProvider(session, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ accepted: true }),
      },
    });
    return true;
  };

  const clearConfigurationTimer = (session) => {
    if (!session.configurationTimer) return false;
    configurationClearTimeout(session.configurationTimer);
    session.configurationTimer = null;
    return true;
  };

  const terminateProviderUnavailable = (session) => {
    sendBrowser(session, {
      type: "error",
      code: "provider_unavailable",
      message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
    });
    return stop(session.sessionId, "provider");
  };

  const configurationUpdate = (session, nextTools, nextToolChoice) =>
    providerSessionUpdate(
      policy,
      nextTools,
      providerToCanonical,
      nextToolChoice,
    );

  const runConfigurationContinuation = (session) => {
    const continuations = session.configurationContinuations.splice(0);
    if (!continuations.length) return;
    continuations
      .reduce(
        (previous, continuation) => previous.then(continuation),
        Promise.resolve(),
      )
      .catch(() => stop(session.sessionId, "protocol"));
  };

  const sendPendingConfiguration = (session) => {
    if (
      session.state === "stopped" ||
      session.pendingConfiguration ||
      !session.providerSocket
    )
      return false;
    const desired = session.desiredConfiguration ?? {
      tools: session.tools,
      toolChoice: session.toolChoice,
    };
    const nextTools = desired.tools;
    const nextToolChoice = desired.toolChoice;
    session.desiredConfiguration = null;
    const update = configurationUpdate(session, nextTools, nextToolChoice);
    const key = canonical(update.session);
    session.tools = nextTools;
    session.toolChoice = nextToolChoice;
    session.pendingConfiguration = {
      key,
      toolNames: update.session.tools.map(({ name }) => name),
      toolChoice: structuredClone(update.session.tool_choice),
      instructions: update.session.instructions,
    };
    clearConfigurationTimer(session);
    session.configurationTimer = configurationSetTimeout(() => {
      if (
        sessions.get(session.sessionId) === session &&
        session.pendingConfiguration
      )
        terminateProviderUnavailable(session);
    }, policy.responseTimeoutSeconds * 1_000);
    session.configurationTimer?.unref?.();
    sendProvider(session, update);
    return true;
  };

  const requestProviderConfiguration = (
    session,
    nextTools,
    continuation = null,
    toolChoice = nextTools.length ? AUTO_TOOL_CHOICE : NO_TOOL_CHOICE,
  ) => {
    if (session.state === "stopped") return false;
    if (continuation) session.configurationContinuations.push(continuation);
    session.desiredConfiguration = {
      tools: [...nextTools],
      toolChoice: structuredClone(toolChoice),
    };
    if (!session.pendingConfiguration) sendPendingConfiguration(session);
    return true;
  };

  const acknowledgeProviderConfiguration = (session, event) => {
    const pending = session.pendingConfiguration;
    if (!pending || !event.session || typeof event.session !== "object")
      return stop(session.sessionId, "protocol");
    const acknowledgedNames = Array.isArray(event.session.tools)
      ? event.session.tools.map(({ name }) => name)
      : [];
    if (
      canonical(acknowledgedNames) !== canonical(pending.toolNames) ||
      canonical(event.session.tool_choice) !== canonical(pending.toolChoice) ||
      event.session.instructions !== pending.instructions
    )
      return stop(session.sessionId, "protocol");
    clearConfigurationTimer(session);
    session.acceptedConfigurationKey = pending.key;
    session.pendingConfiguration = null;
    if (session.desiredConfiguration) return sendPendingConfiguration(session);
    runConfigurationContinuation(session);
    return true;
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

  const startTranscriptionWatchdog = (session) => {
    clearTranscriptionWatchdog(session);
    session.transcriptionTimer = responseSetTimeout(() => {
      if (
        sessions.get(session.sessionId) !== session ||
        session.state === "stopped" ||
        !session.transcriptionReservationId ||
        session.finalInputTranscript
      )
        return;
      sendBrowser(session, {
        type: "error",
        code: "provider_unavailable",
        message: VOICE_SERVICE_UNAVAILABLE_MESSAGE,
      });
      sendProvider(session, { type: "response.cancel" });
      stop(session.sessionId, "response_timeout");
    }, policy.responseTimeoutSeconds * 1_000);
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
      !session.responseReservationId &&
      !session.transcriptionReservationId &&
      !session.activeReservedTurnId &&
      !session.pendingResponseStage &&
      session.pendingCalls.size === 0 &&
      ![
        "classification",
        "awaiting_classification",
        "awaiting_transcript",
      ].includes(session.nativeStage)
    )
      sendBrowser(session, {
        type: "session.state",
        state: "listening",
      });
  };

  const scopeToolsForTurn = (
    session,
    utterance,
    { includeFoundational = true } = {},
  ) => {
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
      catalogRevision:
        session.interfaceContext?.activeFilters?.eventComposerState
          ?.catalogRevision ?? null,
    });
    const available = new Set([
      ...(includeFoundational ? FOUNDATIONAL_CAPABILITY_IDS : []),
      ...scope.capabilityIds.slice(0, 15),
    ]);
    session.tools = tools.filter(({ name }) =>
      available.has(providerToCanonical.get(name)),
    );
    return { ...scope, tools: session.tools };
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
      session.pendingDeterministicArguments =
        scope.deterministicArguments ?? null;
      requestProviderConfiguration(session, [], null, NO_TOOL_CHOICE);
      return true;
    }
    session.suppressProviderOutput =
      session.nativeStage !== null && scope.tools.length > 0;
    if (session.nativeStage === null && scope.tools.length > 0) {
      session.bufferedProviderOutput = [];
      session.bufferedProviderOutputBytes = 0;
    } else discardBufferedProviderOutput(session);
    return requestProviderConfiguration(session, scope.tools, () =>
      sendResponseCreate(session, {
        instructions: TOOL_STAGE_RESPONSE_INSTRUCTIONS,
      }),
    );
  };

  const startOpeningGreeting = async (session) => {
    if (!openingGreeting) {
      sendBrowser(session, {
        type: "session.state",
        state: "listening",
      });
      return true;
    }
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
    sendBrowser(session, { type: "session.state", state: "processing" });
    prepareExpectedSpeech(session, AMBLE_WELCOME_MESSAGE);
    sendResponseCreate(session, {
      conversation: "none",
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
    clearResponseWatchdog(session);
    clearTranscriptionWatchdog(session);
    clearConfigurationTimer(session);
    sendBrowser(session, { type: "session.stopped", reason });
    for (const reservationId of session.openReservations) {
      const isResponse = reservationId === session.responseReservationId;
      const isTranscription =
        reservationId === session.transcriptionReservationId;
      const mustHold = isResponse
        ? session.responseCreated
        : isTranscription
          ? session.inputCommitted
          : true;
      const conservativeAmount = isTranscription
        ? reservations.transcriptionMicroUsd
        : reservations.responseMicroUsd;
      const conservativeUserSettlement = mustHold && reason === "user";
      const operation = conservativeUserSettlement
        ? budgetRepository.settle({
            reservationId,
            settledMicroUsd: conservativeAmount,
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

  const reserveResponseStage = async (session) => {
    if (session.responseStageCount >= policy.maxResponseStagesPerTurn) {
      stop(session.sessionId, "protocol");
      return null;
    }
    try {
      session.responseReservationId = await reserve(
        session,
        "response",
        reservations.responseMicroUsd,
      );
    } catch {
      stop(session.sessionId, "usage_limit");
      return null;
    }
    session.responseStageCount += 1;
    session.responseCreated = false;
    return session.responseReservationId;
  };

  const requestResponseStage = async (
    session,
    {
      tools: stageTools = [],
      toolChoice = stageTools.length ? AUTO_TOOL_CHOICE : NO_TOOL_CHOICE,
      response = {},
      beforeCreate = null,
      expectedSpeech = null,
      retryExpectedSpeech = false,
    } = {},
  ) => {
    if (session.state === "stopped") return false;
    if (session.responseCreated) {
      if (session.pendingResponseStage)
        return stop(session.sessionId, "protocol");
      session.pendingResponseStage = {
        tools: [...stageTools],
        toolChoice: structuredClone(toolChoice),
        response: structuredClone(response),
        beforeCreate,
        expectedSpeech,
        retryExpectedSpeech,
      };
      return true;
    }
    if (!session.responseReservationId) {
      const reservationId = await reserveResponseStage(session);
      if (!reservationId || session.state === "stopped") return false;
    }
    session.suppressProviderOutput = stageTools.length > 0;
    if (expectedSpeech)
      prepareExpectedSpeech(session, expectedSpeech, {
        retry: retryExpectedSpeech,
      });
    return requestProviderConfiguration(
      session,
      stageTools,
      () => {
        beforeCreate?.();
        return sendResponseCreate(session, response);
      },
      toolChoice,
    );
  };

  const runPendingResponseStage = (session) => {
    const pending = session.pendingResponseStage;
    if (!pending || session.state === "stopped") return false;
    session.pendingResponseStage = null;
    void requestResponseStage(session, pending).catch(() =>
      stop(session.sessionId, "protocol"),
    );
    return true;
  };

  const completeCapabilityCall = async (session, pendingCall) => {
    session.pendingCalls.delete(pendingCall.callId);
    session.pendingCallIds.delete(pendingCall.callId);
    session.terminalCalls.set(pendingCall.callId, {
      ...pendingCall,
      result: structuredClone(pendingCall.result),
    });
    const appendResult = () => {
      appendPendingIngressOutput(session);
      if (pendingCall.providerCall !== false)
        return sendProvider(session, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: pendingCall.callId,
            output: JSON.stringify(pendingCall.result),
          },
        });
      return sendProvider(session, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `The deterministic application capability ${pendingCall.capabilityId} completed with this authoritative result: ${JSON.stringify(pendingCall.result)}. Briefly describe that verified outcome.`,
            },
          ],
        },
      });
    };
    sendBrowser(session, {
      type: "capability.completed",
      callId: pendingCall.callId,
      capabilityId: pendingCall.capabilityId,
      kind: pendingCall.kind,
      result: pendingCall.result,
    });
    const expectedSpeech = capabilityResultSpeech(
      pendingCall.capabilityId,
      pendingCall.arguments,
      pendingCall.result,
    );
    return requestResponseStage(session, {
      tools: [],
      toolChoice: NO_TOOL_CHOICE,
      response: {
        conversation: "none",
        instructions: buildVerbatimSpeechInstructions(expectedSpeech),
      },
      beforeCreate: appendResult,
      expectedSpeech,
    });
  };

  const settleFinalTranscription = async (session) => {
    const reservationId = session.transcriptionReservationId;
    if (!reservationId) return false;
    try {
      await budgetRepository.settle({
        reservationId,
        settledMicroUsd: reservations.transcriptionMicroUsd,
        usageShapeHash: "sha256:provider-final-transcript-max-bound",
        settledAt: now().toISOString(),
      });
      session.openReservations = session.openReservations.filter(
        (id) => id !== reservationId,
      );
      session.transcriptionReservationId = null;
      clearTranscriptionWatchdog(session);
      return true;
    } catch {
      await hold(session, reservationId, "settlement_failure");
      return false;
    }
  };

  const routeJoinedNativeTurn = async (session) => {
    if (
      session.nativeStage === "routed" ||
      !session.finalInputTranscript ||
      !session.nativeClassification ||
      !session.nativeClassificationCallId
    )
      return false;
    const utterance = session.finalInputTranscript;
    const ingress = session.nativeClassification;
    const callId = session.nativeClassificationCallId;
    if (!(await settleFinalTranscription(session))) return false;
    if (session.state === "stopped") return false;
    session.nativeStage = "routed";
    session.pendingIngressCallId = callId;
    const scope = scopeToolsForTurn(session, utterance, {
      includeFoundational: false,
    });
    if (
      ingress.domain === "event" &&
      scope.deterministicCapabilityId === "event.applyquery" &&
      session.availableCapabilityIds.includes("event.applyquery")
    ) {
      const registered = contracts.get("event.applyquery");
      const composerState =
        session.interfaceContext?.activeFilters?.eventComposerState;
      const argumentsValue = {
        text: utterance,
        mode: selectVoiceEventQueryMode(utterance, composerState),
        baseContextRevision: session.interfaceContext?.revision ?? 0,
        catalogRevision:
          session.interfaceContext?.eventFacetCatalog?.catalogRevision ??
          session.interfaceContext?.activeFilters?.eventComposerState
            ?.catalogRevision ??
          null,
        ...(ingress.eventQuery ? { facetProposal: ingress.eventQuery } : {}),
      };
      if (!registered || !registered.validateArguments(argumentsValue).valid)
        return stop(session.sessionId, "protocol");
      session.pendingCallIds.add(callId);
      session.pendingCalls.set(callId, {
        callId,
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        confirmationClass: registered.contract.confirmationClass,
        argumentsKey: canonical(argumentsValue),
        arguments: structuredClone(argumentsValue),
        proposalRevision: session.interfaceContext?.revision ?? 0,
        validateResult: registered.validateResult,
        result: null,
        providerCall: false,
      });
      sendBrowser(session, {
        type: "capability.proposed",
        callId,
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        arguments: argumentsValue,
        contextRevision: session.interfaceContext?.revision ?? 0,
      });
      return true;
    }
    if (scope.deterministicCapabilityId) {
      const registered = contracts.get(scope.deterministicCapabilityId);
      if (
        !registered ||
        !scope.deterministicArguments ||
        !registered.validateArguments(scope.deterministicArguments).valid
      )
        return stop(session.sessionId, "protocol");
      const argumentsValue = structuredClone(scope.deterministicArguments);
      session.pendingCallIds.add(callId);
      session.pendingCalls.set(callId, {
        callId,
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        confirmationClass: registered.contract.confirmationClass,
        argumentsKey: canonical(argumentsValue),
        arguments: structuredClone(argumentsValue),
        proposalRevision: session.interfaceContext?.revision ?? 0,
        validateResult: registered.validateResult,
        result: null,
        providerCall: false,
      });
      sendBrowser(session, {
        type: "capability.proposed",
        callId,
        capabilityId: registered.contract.capabilityId,
        kind: registered.contract.kind,
        arguments: argumentsValue,
        contextRevision: session.interfaceContext?.revision ?? 0,
      });
      return true;
    }
    if (scope.tools.length) {
      session.nativeStage = "domain";
      return requestResponseStage(session, {
        tools: scope.tools,
        toolChoice: AUTO_TOOL_CHOICE,
        beforeCreate: () => appendPendingIngressOutput(session),
      });
    }
    session.nativeStage = "final";
    const terminalSpeech =
      ingress.domain === "ambiguous"
        ? "Could you clarify which Amble feature you want to use?"
        : OUT_OF_SCOPE_RESPONSE;
    return requestResponseStage(session, {
      tools: [],
      toolChoice: NO_TOOL_CHOICE,
      response: {
        conversation: "none",
        instructions: buildVerbatimSpeechInstructions(terminalSpeech),
      },
      beforeCreate: () => appendPendingIngressOutput(session),
      expectedSpeech: terminalSpeech,
    });
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
    if (event.type === "error") return terminateProviderUnavailable(session);
    if (event.type === "session.updated")
      return acknowledgeProviderConfiguration(session, event);
    if (event.type === "input_audio_buffer.committed") {
      if (
        !session.inputCommitted ||
        typeof event.item_id !== "string" ||
        !event.item_id ||
        event.item_id.length > 128 ||
        (session.providerInputItemId &&
          session.providerInputItemId !== event.item_id)
      )
        return stop(session.sessionId, "protocol");
      session.providerInputItemId = event.item_id;
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.failed") {
      if (!session.transcriptionReservationId) return;
      return terminateProviderUnavailable(session);
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      if (!session.transcriptionReservationId) return;
      const transcript =
        typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (
        !session.inputCommitted ||
        typeof event.item_id !== "string" ||
        !event.item_id ||
        event.item_id.length > 128 ||
        !transcript ||
        transcript.length > 500 ||
        (session.providerInputItemId &&
          session.providerInputItemId !== event.item_id)
      )
        return stop(session.sessionId, "protocol");
      if (session.finalInputTranscript) {
        if (
          session.providerInputItemId === event.item_id &&
          session.finalInputTranscript === transcript
        )
          return;
        return stop(session.sessionId, "protocol");
      }
      session.providerInputItemId = event.item_id;
      session.finalInputTranscript = transcript;
      if (session.nativeStage === "classification")
        session.nativeStage = "awaiting_classification";
      return routeJoinedNativeTurn(session);
    }
    if (event.type === "conversation.item.input_audio_transcription.delta")
      return;
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
    if (
      event.type === "response.output_audio.delta" &&
      !session.suppressProviderOutput &&
      !Array.isArray(session.bufferedProviderOutput)
    )
      sendBrowser(session, { type: "session.state", state: "speaking" });
    if (event.type === "response.function_call_arguments.done") {
      if (event.name === VOICE_INGRESS_TOOL_NAME) {
        if (
          !["classification", "awaiting_classification"].includes(
            session.nativeStage,
          ) ||
          session.tools.length !== 1 ||
          session.tools[0]?.name !== VOICE_INGRESS_TOOL_NAME ||
          typeof event.call_id !== "string" ||
          !event.call_id ||
          event.call_id.length > 128
        )
          return stop(session.sessionId, "protocol");
        let ingress;
        try {
          ingress = canonicalizeVoiceIngress(
            JSON.parse(event.arguments || "{}"),
          );
        } catch {
          return stop(session.sessionId, "protocol");
        }
        if (
          !ingress ||
          typeof ingress !== "object" ||
          Array.isArray(ingress) ||
          Object.keys(ingress).length !== 2 ||
          !["event", "other", "ambiguous"].includes(ingress.domain) ||
          (ingress.domain === "event" &&
            ingress.eventQuery !== null &&
            (typeof ingress.eventQuery !== "object" ||
              Array.isArray(ingress.eventQuery))) ||
          (ingress.domain !== "event" && ingress.eventQuery !== null)
        )
          return stop(session.sessionId, "protocol");
        session.nativeClassification = ingress;
        session.nativeClassificationCallId = event.call_id;
        session.nativeStage = "awaiting_transcript";
        return routeJoinedNativeTurn(session);
      }
      const capabilityId = providerToCanonical.get(event.name);
      discardBufferedProviderOutput(session);
      const tool = session.tools.find(
        (candidate) => candidate.name === event.name,
      );
      const registered = contracts.get(capabilityId);
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
          capabilityId,
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
        if (session.pendingResponseStage) return true;
        return requestResponseStage(session, {
          tools: [],
          toolChoice: NO_TOOL_CHOICE,
        });
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
        arguments: structuredClone(argumentsValue),
        proposalRevision: session.interfaceContext?.revision ?? 0,
        validateResult: registered.validateResult,
        result: null,
      });
      sendBrowser(session, {
        type: "capability.proposed",
        callId: event.call_id,
        capabilityId,
        kind: registered.contract.kind,
        arguments: argumentsValue,
        contextRevision: session.interfaceContext?.revision ?? 0,
      });
      return;
    }
    const sanitized = sanitizeProviderEvent(event);
    if (!sanitized) return;
    if (event.type === "response.done") {
      if (session.expectedSpeech) {
        const actualSpeech = bufferedProviderTranscript(session);
        const producedAssistantOutput =
          (session.bufferedProviderOutput?.length ?? 0) > 0;
        if (
          !producedAssistantOutput ||
          actualSpeech === session.expectedSpeech
        ) {
          flushBufferedProviderOutput(session);
          session.expectedSpeech = null;
          session.expectedSpeechRetryCount = 0;
        } else {
          discardBufferedProviderOutput(session);
          if (
            session.expectedSpeechRetryCount < 1 &&
            !session.pendingResponseStage
          ) {
            session.expectedSpeechRetryCount += 1;
            session.pendingResponseStage = {
              tools: [],
              toolChoice: NO_TOOL_CHOICE,
              response: {
                conversation: "none",
                instructions: buildVerbatimSpeechInstructions(
                  session.expectedSpeech,
                ),
              },
              beforeCreate: null,
              expectedSpeech: session.expectedSpeech,
              retryExpectedSpeech: true,
            };
          } else {
            session.stopAfterSettlement = "protocol";
          }
        }
      } else {
        flushBufferedProviderOutput(session);
      }
      clearResponseWatchdog(session);
      tracePhase(session, "response_done");
    }
    const assistantOutput = ASSISTANT_OUTPUT_EVENT_TYPES.has(
      sanitized.browserEvent?.type,
    );
    const suppressBrowserOutput =
      session.suppressProviderOutput && assistantOutput;
    if (
      sanitized.browserEvent &&
      assistantOutput &&
      Array.isArray(session.bufferedProviderOutput)
    ) {
      const bytes = JSON.stringify(sanitized.browserEvent).length;
      session.bufferedProviderOutputBytes += bytes;
      if (session.bufferedProviderOutputBytes > BUFFERED_PROVIDER_OUTPUT_LIMIT)
        return stop(session.sessionId, "protocol");
      session.bufferedProviderOutput.push(sanitized.browserEvent);
    } else if (sanitized.browserEvent && !suppressBrowserOutput)
      sendBrowser(session, sanitized.browserEvent);
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
      const missingRequiredIngress = [
        "classification",
        "awaiting_classification",
      ].includes(session.nativeStage);
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
        if (session.stopAfterSettlement) {
          const reason = session.stopAfterSettlement;
          session.stopAfterSettlement = null;
          return stop(session.sessionId, reason);
        }
        if (missingRequiredIngress) return stop(session.sessionId, "protocol");
        if (!runPendingResponseStage(session))
          resumeListeningWhenSettled(session);
      } catch {
        await hold(session, reservationId, "settlement_failure");
      }
    }
  };

  const attach = async (sessionId, browserSocket) => {
    const session = sessions.get(sessionId);
    if (!session || session.browserSocket)
      throw new Error("Voice session is unavailable");
    session.browserSocket = browserSocket;
    browserSocket.accept?.();
    try {
      session.providerSocket = await providerConnector({
        apiKey,
        modelId: policy.modelId,
        fetchImpl,
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
    requestProviderConfiguration(
      session,
      [],
      async () => {
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
        await startOpeningGreeting(session);
      },
      NO_TOOL_CHOICE,
    );
    return session;
  };

  const handleBrowserMessage = async (sessionId, rawMessage) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Voice session is unavailable");
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
    if (message.type === "session.stop") return stop(sessionId, message.reason);
    if (message.type === "turn.request") {
      if (
        session.activeReservedTurnId ||
        session.responseReservationId ||
        session.transcriptionReservationId
      )
        return stop(sessionId, "protocol");
      session.responseStageCount = 0;
      session.nativeStage = "awaiting_audio";
      if (!(await reserveResponseStage(session))) return;
      try {
        session.transcriptionReservationId = await reserve(
          session,
          "input_transcription",
          reservations.transcriptionMicroUsd,
        );
      } catch {
        return stop(sessionId, "usage_limit");
      }
      session.inputAudioBytes = 0;
      session.providerInputItemId = null;
      session.finalInputTranscript = null;
      session.nativeClassification = null;
      session.nativeClassificationCallId = null;
      session.activeReservedTurnId = message.turnId;
      return sendBrowser(session, {
        type: "turn.ready",
        turnId: message.turnId,
      });
    }
    if (message.type === "audio.append") {
      const padding = message.audio.endsWith("==")
        ? 2
        : message.audio.endsWith("=")
          ? 1
          : 0;
      const decodedBytes = Math.floor((message.audio.length * 3) / 4) - padding;
      session.inputAudioBytes += decodedBytes;
      const maxAudioBytes =
        policy.worstCaseReservation.inputTranscription.maxAudioSeconds *
        24_000 *
        2;
      if (session.inputAudioBytes > maxAudioBytes)
        return stop(sessionId, "usage_limit");
      return sendProvider(session, {
        type: "input_audio_buffer.append",
        audio: message.audio,
      });
    }
    if (message.type === "audio.commit") {
      startTurnTrace(session);
      tracePhase(session, "audio_committed");
      session.activeReservedTurnId = null;
      session.inputCommitted = true;
      session.nativeStage = "classification";
      startTranscriptionWatchdog(session);
      const ingressTool = createVoiceIngressTool(
        session.interfaceContext?.eventFacetCatalog,
      );
      return requestResponseStage(session, {
        tools: [ingressTool],
        toolChoice: VOICE_INGRESS_TOOL_CHOICE,
        response: {
          instructions: buildVoiceIngressResponseInstructions(),
        },
        beforeCreate: () =>
          sendProvider(session, { type: "input_audio_buffer.commit" }),
      });
    }
    if (message.type === "text.submit") {
      if (
        session.activeReservedTurnId ||
        session.responseReservationId ||
        session.transcriptionReservationId
      )
        return stop(sessionId, "protocol");
      startTurnTrace(session);
      session.responseStageCount = 0;
      session.nativeStage = null;
      if (!(await reserveResponseStage(session))) return;
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
      const deterministicArguments = structuredClone(
        session.pendingDeterministicArguments ?? {},
      );
      session.pendingDeterministic = null;
      session.pendingDeterministicArguments = null;
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
      const expectedSpeech = capabilityResultSpeech(
        message.capabilityId,
        deterministicArguments,
        message.result,
      );
      return requestResponseStage(session, {
        tools: [],
        toolChoice: NO_TOOL_CHOICE,
        response: {
          conversation: "none",
          instructions: buildVerbatimSpeechInstructions(expectedSpeech),
        },
        expectedSpeech,
      });
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
        session.tools = [];
        requestProviderConfiguration(session, [], null, NO_TOOL_CHOICE);
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
      responseStageCount: 0,
      activeReservedTurnId: null,
      responseReservationId: null,
      transcriptionReservationId: null,
      inputCommitted: false,
      inputAudioBytes: 0,
      responseCreated: false,
      responseTimer: null,
      transcriptionTimer: null,
      configurationTimer: null,
      pendingConfiguration: null,
      acceptedConfigurationKey: null,
      desiredConfiguration: null,
      configurationContinuations: [],
      turnNumber: 0,
      turnTrace: null,
      openReservations: [],
      pendingCallIds: new Set(),
      pendingCalls: new Map(),
      terminalCalls: new Map(),
      approvedCandidateIds: new Set(approvedCandidateIds),
      approvedCandidates: structuredClone(approvedCandidates),
      availableCapabilityIds: [],
      tools: [],
      toolChoice: NO_TOOL_CHOICE,
      pendingConfirmation: null,
      pendingDeterministic: null,
      pendingDeterministicArguments: null,
      suppressProviderOutput: false,
      bufferedProviderOutput: null,
      bufferedProviderOutputBytes: 0,
      expectedSpeech: null,
      expectedSpeechRetryCount: 0,
      stopAfterSettlement: null,
      pendingResponseStage: null,
      pendingIngressCallId: null,
      nativeStage: null,
      providerInputItemId: null,
      finalInputTranscript: null,
      nativeClassification: null,
      nativeClassificationCallId: null,
      transcriptItems: [],
      intent: null,
      exactLocation: null,
      interfaceContext: null,
      browserSocket: null,
      providerSocket: null,
      abortController: new AbortController(),
      providerEventQueue: Promise.resolve(),
      browserEventQueue: Promise.resolve(),
    };
    sessions.set(sessionId, session);
    return {
      ok: true,
      data: {
        sessionId,
        protocolVersion: validated.protocolVersion,
        streamPath: `/api/voice/sessions/${encodeURIComponent(sessionId)}/stream`,
        limits: {
          maxResponseStagesPerTurn: policy.maxResponseStagesPerTurn,
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
    session.tools = [];
    session.toolChoice = NO_TOOL_CHOICE;
    if (session.providerSocket)
      requestProviderConfiguration(session, [], null, NO_TOOL_CHOICE);
    return session.tools.map(({ name }) => providerToCanonical.get(name));
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
