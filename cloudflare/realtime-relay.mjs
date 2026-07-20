import {
  cleanupRelaySession,
  sanitizeProviderEvent,
  validateBrowserMessage,
  validateSessionAdmission,
} from "../scripts/lib/realtime-relay-protocol.mjs";
import { createPublicActionContracts } from "../activity-scenes/assistant/actions/index.js";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime";
const OUT_OF_SCOPE_RESPONSE =
  "I can only help you explore Singapore and use Amble's current features.";
export const AMBLE_WELCOME_MESSAGE =
  "Hi, I'm Amble, your Singapore discovery guide. Tell me what you're in the mood for, and I can suggest areas and places, search events or restaurants, and control the map—including your location and MRT context.";

export function describeAvailableCapabilities(tools = []) {
  return tools.map(({ name, description }) => `${name}: ${description}`);
}

export function buildAmbleSessionInstructions(tools = []) {
  const capabilities = describeAvailableCapabilities(tools);
  return [
    "You are Amble, the in-application voice guide and controller for this Singapore discovery application. You are not a general-purpose assistant.",
    "Stay strictly within Amble: discover from supplied approved application data, explain currently eligible Amble features, and control the application only through the supplied typed tools.",
    `For unrelated requests or general knowledge, reply briefly: \"${OUT_OF_SCOPE_RESPONSE}\" Then offer a relevant in-app alternative when one exists. Do not answer the unrelated question.`,
    "You must not browse or search the open web. Search tools query only approved data already available inside Amble. Never imply that you have unrestricted browser, device, operating-system, or application control.",
    "When asked what you can do, describe only the current eligible capabilities listed below. Group them concisely in user language. Do not mention unavailable, internal, or imagined features.",
    `For the user's opening greeting or a simple hello, respond exactly with: \"${AMBLE_WELCOME_MESSAGE}\" Do not invite general conversation, games of chat, trivia, mysteries, or unrelated help.`,
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

export const PUBLIC_ACTION_RELAY_TOOLS = Object.freeze(
  createPublicActionContracts({
    dispatch: () => ({ changed: false }),
  }).map(({ actionId, description, argumentSchema }) =>
    Object.freeze({
      type: "function",
      name: actionId,
      description,
      parameters: structuredClone(argumentSchema),
    }),
  ),
);

export const DEFAULT_RELAY_TOOLS = Object.freeze([
  ...DISCOVERY_RELAY_TOOLS,
  ...PUBLIC_ACTION_RELAY_TOOLS,
]);

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
    policy?.schemaVersion !== "1.0" ||
    policy.owner !== "Arnav" ||
    policy.modelId !== "gpt-realtime-2.1" ||
    policy.transcriptionModelId !== "gpt-realtime-whisper" ||
    policy.capMicroUsd !== 10_000_000 ||
    policy.resetPolicy !== "none" ||
    policy.rateCardVersion !== policy.rateCard?.version ||
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
      max_output_tokens: policy.maxOutputTokens,
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
  tools = DEFAULT_RELAY_TOOLS,
  approvedCandidateIds = [],
  approvedCandidates = [],
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

  const scheduleIdle = (session) => {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(
      () => stop(session.sessionId, "idle"),
      policy.idleSeconds * 1_000,
    );
    session.idleTimer?.unref?.();
  };

  const resumeListeningWhenSettled = (session) => {
    if (
      !session.inputReservationId &&
      !session.responseReservationId &&
      !session.activeReservedTurnId
    )
      send(session.browserSocket, {
        type: "session.state",
        state: "listening",
      });
  };

  const stop = (sessionId, reason) => {
    const session = sessions.get(sessionId);
    if (!session) return null;
    send(session.browserSocket, { type: "session.stopped", reason });
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

  const onProviderEvent = async (session, rawEvent) => {
    let event;
    try {
      event = typeof rawEvent === "string" ? JSON.parse(rawEvent) : rawEvent;
    } catch {
      return stop(session.sessionId, "protocol");
    }
    session.lastProviderEventType = event.type;
    if (event.type === "response.created")
      send(session.browserSocket, {
        type: "session.state",
        state: "processing",
      });
    if (event.type === "response.output_audio.delta")
      send(session.browserSocket, { type: "session.state", state: "speaking" });
    if (event.type === "response.function_call_arguments.done") {
      const tool = session.tools.find(
        (candidate) => candidate.name === event.name,
      );
      if (
        !tool ||
        typeof event.call_id !== "string" ||
        event.call_id.length > 128 ||
        session.pendingCallIds.size >= 1
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
      try {
        validateDiscoveryToolArguments(
          event.name,
          argumentsValue,
          session.approvedCandidateIds,
        );
      } catch {
        return stop(session.sessionId, "protocol");
      }
      session.pendingCallIds.add(event.call_id);
      send(session.browserSocket, {
        type: "action.proposed",
        callId: event.call_id,
        actionId: event.name,
        arguments: argumentsValue,
      });
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      session.inputReservationId
    ) {
      const settled = await settleInputReservation(
        session,
        event.usage && typeof event.usage === "object"
          ? await hash(JSON.stringify(Object.keys(event.usage).sort()))
          : "sha256:fixed-transcription-reservation",
      );
      if (!settled) return;
      resumeListeningWhenSettled(session);
    }
    const sanitized = sanitizeProviderEvent(event);
    if (!sanitized) return;
    if (sanitized.browserEvent)
      send(session.browserSocket, sanitized.browserEvent);
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
      send(
        session.providerSocket,
        providerSessionUpdate(policy, session.tools),
      );
      if (session.approvedCandidates.length)
        send(session.providerSocket, {
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
      void handleBrowserMessage(sessionId, event.data);
    });
    browserSocket.addEventListener?.("close", () => stop(sessionId, "network"));
    scheduleIdle(session);
    send(browserSocket, { type: "session.state", state: "listening" });
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
    let message;
    try {
      message = validateBrowserMessage(parsed, {
        activeReservedTurnId: session.activeReservedTurnId,
        pendingCallIds: session.pendingCallIds,
        pendingConfirmation: session.pendingConfirmation,
        maxMessageBytes: 16 * 1024,
        maxAudioChunkBytes: 12 * 1024,
        maxTextChars: 2_000,
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
      return send(session.browserSocket, {
        type: "turn.ready",
        turnId: message.turnId,
      });
    }
    if (message.type === "audio.append")
      return send(session.providerSocket, {
        type: "input_audio_buffer.append",
        audio: message.audio,
      });
    if (message.type === "audio.commit") {
      send(session.providerSocket, { type: "input_audio_buffer.commit" });
      session.inputCommitted = true;
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
      session.responseCreated = true;
      send(session.providerSocket, {
        type: "response.create",
        response: { max_output_tokens: policy.maxOutputTokens },
      });
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
      session.responseCreated = true;
      send(session.providerSocket, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: message.text }],
        },
      });
      return send(session.providerSocket, {
        type: "response.create",
        response: { max_output_tokens: policy.maxOutputTokens },
      });
    }
    if (message.type === "action.result") {
      session.pendingCallIds.delete(message.callId);
      return send(session.providerSocket, {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: message.callId,
          output: JSON.stringify({
            ok: message.ok,
            result: message.result ?? null,
          }),
        },
      });
    }
    if (message.type === "confirmation.result")
      session.pendingConfirmation = null;
    if (message.type === "response.cancel")
      return send(session.providerSocket, { type: "response.cancel" });
    if (message.type === "context.update") {
      session.interfaceContext = structuredClone(message.context);
      const available = new Set(message.context.availableActionIds || []);
      session.tools = tools.filter(
        ({ name }) => name.startsWith("discovery.") || available.has(name),
      );
      send(
        session.providerSocket,
        providerSessionUpdate(policy, session.tools),
      );
      return send(session.providerSocket, {
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
      openReservations: [],
      pendingCallIds: new Set(),
      approvedCandidateIds: new Set(approvedCandidateIds),
      approvedCandidates: structuredClone(approvedCandidates),
      tools: tools.filter(({ name }) => name.startsWith("discovery.")),
      pendingConfirmation: null,
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

  const setAvailableActionIds = (sessionId, actionIds) => {
    const session = sessions.get(sessionId);
    if (
      !session ||
      !Array.isArray(actionIds) ||
      actionIds.some((id) => typeof id !== "string" || !id)
    )
      throw new TypeError("Available action identities are invalid");
    const available = new Set([
      "discovery.presentareas",
      "discovery.refine",
      ...actionIds,
    ]);
    session.tools = tools.filter(({ name }) => available.has(name));
    if (session.providerSocket)
      send(
        session.providerSocket,
        providerSessionUpdate(policy, session.tools),
      );
    return session.tools.map(({ name }) => name);
  };

  return Object.freeze({
    admit,
    attach,
    handleBrowserMessage,
    setApprovedCandidateIds,
    setAvailableActionIds,
    stop,
    sessions,
  });
}
