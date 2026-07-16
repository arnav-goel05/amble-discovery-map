const crypto = require("node:crypto");
const { PlanGameService } = require("./lib/plan-game-service.cjs");

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function body(request, maxBytes = 96_000) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (Buffer.byteLength(value) > maxBytes) throw new Error("request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function sameSecret(received, expected) {
  if (!expected || !received) return false;
  const left = Buffer.from(received), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function telegramReply(action) {
  const reply_markup = action.requestLocation ? { keyboard: [[{ text: "Share my location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }
    : action.removeKeyboard ? { remove_keyboard: true } : undefined;
  return { chat_id: action.chatId, text: action.text, reply_markup };
}

function safePhotoVerification(result) {
  if (!result || !["accepted", "rejected", "needs_review"].includes(result.status)) return { status: "needs_review", reason: "invalid_provider_result", verifier: "configured-vision-provider" };
  return {
    status: result.status,
    reason: String(result.reason || "provider_result").slice(0, 160),
    verifier: String(result.verifier || "configured-vision-provider").slice(0, 120),
    confidence: Number.isFinite(result.confidence) ? Math.min(1, Math.max(0, result.confidence)) : undefined,
  };
}

function clientError(error) {
  const message = String(error?.message || "");
  const isValidation = /invalid|requires|must|contain|not found|too large|coordinates|stops|expired|revoked/i.test(message);
  return isValidation
    ? { status: 400, payload: { error: message.slice(0, 180) } }
    : { status: 502, payload: { error: "The request could not be completed." } };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("vision verification timed out")), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function planGameApiPlugin(options = {}) {
  const service = options.service || new PlanGameService(options);
  const token = options.telegramToken || process.env.TELEGRAM_BOT_TOKEN || "";
  const webhookSecret = options.webhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const webhookLocks = new Map();
  const workerId = options.workerId || `web-${process.pid}-${crypto.randomUUID()}`;
  const rateLimit = Number(options.telegramRateLimit || process.env.TELEGRAM_RATE_LIMIT_PER_MINUTE || 30);
  const gamesEnabled = options.gamesEnabled ?? process.env.TELEGRAM_GAMES_ENABLED !== "false";
  const visionVerifier = options.visionVerifier;
  const visionTimeoutMs = Number(options.visionTimeoutMs || process.env.PHOTO_VERIFICATION_TIMEOUT_MS || 8_000);
  const logger = options.logger || ((entry) => { if (process.env.STRUCTURED_LOGS_ENABLED === "true") console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "plan-game", ...entry })); });
  const workerIntervalMs = Number(options.workerIntervalMs || process.env.TELEGRAM_QUEUE_INTERVAL_MS || 1_000);
  let workerTimer = null;

  const deliverPersistedActions = async (updateId, actions) => {
    service.saveTelegramDelivery(updateId, actions, false);
    service.enqueueTelegramActions(updateId, actions);
    if (!token) return { status: 503, payload: { error: "TELEGRAM_BOT_TOKEN is not configured", actions } };
    const claimed = service.claimTelegramActions(updateId, workerId);
    if (!claimed.length) return { status: 202, payload: { ok: true, processing: true } };
    for (const message of claimed) {
      try {
        const telegram = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telegramReply(message.payload)),
        });
        const result = await telegram.json().catch(() => null);
        if (!telegram.ok || result?.ok !== true) throw new Error(`Telegram sendMessage failed${result?.description ? `: ${result.description}` : ` with HTTP ${telegram.status}`}`);
        service.markTelegramActionDelivered(message.id);
      } catch (error) {
        service.markTelegramActionFailed(message.id, "provider_request_failed");
        logger({ level: "error", event: "telegram_delivery_failed", messageId: message.id, reasonCode: "provider_request_failed" });
        throw error;
      }
    }
    service.saveTelegramDelivery(updateId, actions, true);
    return { status: 200, payload: { ok: true } };
  };

  const drainOutbox = async () => {
    service.purgeExpiredPhotoSubmissions();
    service.purgeExpiredPlans();
    service.purgeAbandonedSessions();
    service.purgeSettledTelegramRecords();
    if (!token) return { processed: 0 };
    const claimed = service.claimDueTelegramActions(workerId, 50);
    let delivered = 0;
    for (const message of claimed) {
      try {
        const telegram = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telegramReply(message.payload)),
        });
        const result = await telegram.json().catch(() => null);
        if (!telegram.ok || result?.ok !== true) throw new Error(`Telegram sendMessage failed${result?.description ? `: ${result.description}` : ` with HTTP ${telegram.status}`}`);
        service.markTelegramActionDelivered(message.id);
        delivered += 1;
        const remaining = service.telegramOutbox(message.update_id);
        if (remaining.length && remaining.every((row) => row.status === "delivered")) {
          const prior = service.telegramDelivery(message.update_id);
          if (prior) service.saveTelegramDelivery(message.update_id, prior.actions, true);
        }
      } catch (error) {
        service.markTelegramActionFailed(message.id, "provider_request_failed");
        logger({ level: "error", event: "telegram_delivery_failed", source: "worker", messageId: message.id, reasonCode: "provider_request_failed" });
      }
    }
    return { processed: claimed.length, delivered };
  };

  const startWorker = () => {
    if (workerTimer || !token) return;
    workerTimer = setInterval(() => drainOutbox().catch(() => logger({ level: "error", event: "telegram_worker_failed", reasonCode: "worker_iteration_failed" })), Math.max(250, workerIntervalMs));
    workerTimer.unref?.();
    drainOutbox().catch(() => logger({ level: "error", event: "telegram_worker_failed", reasonCode: "worker_iteration_failed" }));
  };
  const stopWorker = () => { if (workerTimer) clearInterval(workerTimer); workerTimer = null; };

  const processTelegram = async (update) => {
    const prior = service.telegramDelivery(update.update_id);
    if (prior?.delivered) return { status: 200, payload: { ok: true, duplicate: true } };
    if (!prior && !service.claimTelegramUpdate(update).claimed) return { status: 202, payload: { ok: true, processing: true, duplicate: true } };
    const chatId = update?.message?.chat?.id;
    if (!prior && chatId !== undefined && chatId !== null) {
      const allowance = service.consumeTelegramRateLimit(chatId, rateLimit, 60_000);
      if (!allowance.allowed) {
        service.recordTelegramUpdate(update, "rate_limited", "rate limit exceeded");
        return { status: 429, payload: { error: "Telegram update rate limit exceeded", retryAfterMs: allowance.retryAfterMs } };
      }
    }
    let handledUpdate = update;
    if (!prior?.actions && service.photoVerificationEnabled && visionVerifier && Array.isArray(update?.message?.photo) && update.message.photo.length) {
      try {
        const verification = await withTimeout(Promise.resolve(visionVerifier.verify({ update, message: update.message })), visionTimeoutMs);
        handledUpdate = { ...update, photoVerification: safePhotoVerification(verification) };
      } catch (error) {
        handledUpdate = { ...update, photoVerification: { status: "needs_review", reason: "provider_unavailable", verifier: "configured-vision-provider" } };
        service.recordTelegramUpdate(update, "vision_unavailable", "provider_unavailable");
      }
    }
    const actions = prior?.actions || service.handleTelegramUpdate(handledUpdate);
    try {
      const delivery = await deliverPersistedActions(update.update_id, actions);
      if (delivery.status !== 200) return delivery;
    } catch (error) {
      service.recordTelegramUpdate(update, "delivery_failed", "provider_request_failed");
      throw error;
    }
    service.recordTelegramUpdate(update, "delivered");
    return { status: 200, payload: { ok: true } };
  };

  const lockedTelegram = (update) => {
    const key = Number.isFinite(update.update_id) ? String(update.update_id) : `missing-${crypto.randomUUID()}`;
    const previous = webhookLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => processTelegram(update));
    webhookLocks.set(key, current);
    current.finally(() => { if (webhookLocks.get(key) === current) webhookLocks.delete(key); }).catch(() => {});
    return current;
  };

  const middleware = async (request, response, next) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/game-readiness") {
        return json(response, 200, {
          enabled: gamesEnabled,
          botConfigured: Boolean(service.botUsername),
          deliveryConfigured: Boolean(token && webhookSecret),
          visionConfigured: Boolean(visionVerifier),
          adaptiveLocationEnabled: service.adaptiveLocationEnabled,
          photoVerificationEnabled: service.photoVerificationEnabled,
          storage: service.diagnostics().storage,
        });
      }
      if (request.method === "GET" && url.pathname === "/health/live") return json(response, 200, { ok: true });
      if (request.method === "GET" && url.pathname === "/health/ready") {
        const diagnostics = service.diagnostics();
        const ready = gamesEnabled && Boolean(service.botUsername) && Boolean(token && webhookSecret) && diagnostics.storage === "sqlite";
        return json(response, ready ? 200 : 503, { ok: ready, gamesEnabled, botConfigured: Boolean(service.botUsername), deliveryConfigured: Boolean(token && webhookSecret), storage: diagnostics.storage, queueDepth: diagnostics.pendingMessages });
      }
      if (request.method === "POST" && url.pathname === "/api/plans") {
        if (!gamesEnabled) return json(response, 503, { error: "Telegram challenges are disabled" });
        const plan = service.createPlan(await body(request));
        return json(response, 201, plan);
      }
      const planMatch = request.method === "GET" && url.pathname.match(/^\/api\/plans\/(plan_[A-Za-z0-9_-]+)$/);
      if (planMatch) {
        const plan = service.getPlan(planMatch[1]);
        const availability = service.planAvailability(planMatch[1]);
        if (availability === "expired" || availability === "revoked") return json(response, 410, { error: `plan ${availability}` });
        return plan ? json(response, 200, plan) : json(response, 404, { error: "plan was not found" });
      }
      if (request.method === "POST" && url.pathname === "/api/games") {
        if (!gamesEnabled) return json(response, 503, { error: "Telegram challenges are disabled" });
        const game = service.createGame(await body(request));
        return json(response, 201, game);
      }
      const gameMatch = request.method === "GET" && url.pathname.match(/^\/api\/games\/(game_[A-Za-z0-9_-]+)$/);
      if (gameMatch) {
        const game = service.getGame(gameMatch[1]);
        return game ? json(response, 200, game) : json(response, 404, { error: "game was not found" });
      }
      if (request.method === "POST" && url.pathname === "/api/telegram/webhook") {
        if (!webhookSecret || !sameSecret(request.headers["x-telegram-bot-api-secret-token"], webhookSecret)) return json(response, 401, { error: "invalid webhook secret" });
        const update = await body(request);
        if (!Number.isSafeInteger(update?.update_id)) return json(response, 400, { error: "Telegram update_id must be an integer" });
        const result = await lockedTelegram(update);
        return json(response, result.status, result.payload);
      }
      return next();
    } catch (error) {
      const safe = clientError(error);
      return json(response, safe.status, safe.payload);
    }
  };
  return {
    name: "plan-game-api",
    configureServer(server) { startWorker(); server.middlewares.use(middleware); },
    configurePreviewServer(server) { startWorker(); server.middlewares.use(middleware); },
    closeBundle() { stopWorker(); },
    middleware,
    api: service,
    drainOutbox,
    startWorker,
    stopWorker,
  };
}

module.exports = { planGameApiPlugin, sameSecret };
