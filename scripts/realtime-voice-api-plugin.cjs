"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");
const {
  errorEnvelope,
  readJsonBody,
  sendJson,
} = require("./lib/http-contract.cjs");
const {
  createLocalVoiceBudgetRepository,
} = require("./lib/voice-budget-repository.cjs");

const SESSION_PATH = "/api/voice/sessions";
const STREAM_PATH = /^\/api\/voice\/sessions\/([^/]+)\/stream$/;

function nodeProviderConnector({ apiKey, modelId }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(modelId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function realtimeVoiceApiPlugin({
  root = path.resolve(__dirname, ".."),
  environment = process.env,
  databasePath,
  providerConnector = nodeProviderConnector,
} = {}) {
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
  );
  const repository = createLocalVoiceBudgetRepository({
    ...(databasePath ? { databasePath } : {}),
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
  });
  let relayPromise;
  const relay = () =>
    (relayPromise ??= import("../cloudflare/realtime-relay.mjs").then(
      ({ createRealtimeRelay }) =>
        createRealtimeRelay({
          policy,
          budgetRepository: repository,
          apiKey: environment.OPENAI_API_KEY,
          providerConnector,
        }),
    ));

  const requestOrigin = (request) => {
    const proto = request.socket?.encrypted ? "https" : "http";
    return `${proto}://${request.headers.host}`;
  };

  const middleware = async (request, response, next) => {
    let url;
    try {
      url = new URL(request.url, requestOrigin(request));
    } catch {
      return next();
    }
    if (url.pathname !== SESSION_PATH) return next();
    if (request.method !== "POST")
      return sendJson(
        response,
        405,
        errorEnvelope(
          "invalid_request",
          "Voice session admission requires POST.",
        ),
      );
    if (request.headers.origin !== url.origin)
      return sendJson(
        response,
        403,
        errorEnvelope(
          "origin_rejected",
          "Voice sessions require the application origin.",
        ),
      );
    let body;
    try {
      body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    } catch (error) {
      const status =
        error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
      return sendJson(
        response,
        status,
        errorEnvelope("invalid_request", "Voice session request is invalid."),
      );
    }
    try {
      const activeRelay = await relay();
      const result = await activeRelay.admit({
        requestUrl: url.href,
        origin: request.headers.origin,
        contentType: request.headers["content-type"],
        bodyBytes: Buffer.byteLength(JSON.stringify(body)),
        body,
        environmentEnabled: environment.REALTIME_ENABLED === "true",
        providerPolicyValid: true,
        rateCardValid: true,
        reservationAvailable: true,
        rateLimited: false,
      });
      return sendJson(response, 201, result);
    } catch (error) {
      const mapping = {
        voice_disabled: 503,
        usage_limit: 429,
        rate_limited: 429,
        origin_rejected: 403,
        invalid_request: 400,
        policy_mismatch: 503,
        budget_disabled: 503,
        budget_cap_exceeded: 429,
      };
      const code = mapping[error?.code] ? error.code : "provider_unavailable";
      return sendJson(
        response,
        mapping[code] ?? 503,
        errorEnvelope(
          code,
          code === "usage_limit"
            ? "Voice usage is unavailable. Please try again later."
            : "Voice is currently unavailable. Please try again.",
        ),
      );
    }
  };

  const attachUpgrade = (server) => {
    const onUpgrade = async (request, socket, head) => {
      let url;
      try {
        url = new URL(request.url, requestOrigin(request));
      } catch {
        return;
      }
      const match = url.pathname.match(STREAM_PATH);
      if (!match) return;
      if (request.headers.origin !== url.origin) return socket.destroy();
      try {
        const activeRelay = await relay();
        webSocketServer.handleUpgrade(
          request,
          socket,
          head,
          (browserSocket) => {
            activeRelay
              .attach(decodeURIComponent(match[1]), browserSocket)
              .catch(() => browserSocket.close(1011, "Voice unavailable"));
          },
        );
      } catch {
        socket.destroy();
      }
    };
    server.on("upgrade", onUpgrade);
    return () => server.off("upgrade", onUpgrade);
  };

  let detachUpgrade = null;
  const configure = (server) => {
    server.middlewares.use(middleware);
    if (server.httpServer) detachUpgrade = attachUpgrade(server.httpServer);
  };
  const close = async () => {
    detachUpgrade?.();
    if (relayPromise) {
      const activeRelay = await relayPromise;
      for (const sessionId of [...activeRelay.sessions.keys()])
        activeRelay.stop(sessionId, "user");
    }
    webSocketServer.close();
    repository.close();
  };

  return {
    name: "realtime-voice-api",
    middleware,
    attachUpgrade,
    close,
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

module.exports = { nodeProviderConnector, realtimeVoiceApiPlugin };
