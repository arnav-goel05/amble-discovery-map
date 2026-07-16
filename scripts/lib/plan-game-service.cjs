const crypto = require("node:crypto");
const path = require("node:path");
const { SqliteGameRepository } = require("./game-repository.cjs");
const { MetadataPhotoVerifier, distanceMeters, verifyLocationEvidence } = require("./game-verification.cjs");

const SCHEMA_VERSION = "1.0";
const MAX_STOPS = 20;
const DEFAULT_PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PHOTO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const THEMES = new Set(["explorer", "detective", "foodie"]);

function clean(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bounded(value, fallback, minimum, maximum) {
  const number = finite(value);
  return number === null ? fallback : Math.min(maximum, Math.max(minimum, number));
}

function normalizeVerification(stop) {
  const input = stop.verification || {};
  const buildingPolygon = Array.isArray(input.buildingPolygon)
    ? input.buildingPolygon.map((point) => [finite(point?.[0]), finite(point?.[1])])
      .filter(([longitude, latitude]) => longitude !== null && latitude !== null && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90)
    : [];
  return {
    radiusMeters: bounded(input.radiusMeters, stop.type === "restaurant" ? 120 : 180, 25, 500),
    maxAccuracyMeters: bounded(input.maxAccuracyMeters, 150, 25, 500),
    maxAgeSeconds: bounded(input.maxAgeSeconds, 300, 30, 900),
    requireConsistentReadings: Boolean(input.requireConsistentReadings),
    buildingId: clean(input.buildingId, 120) || null,
    buildingPolygon: buildingPolygon.length >= 3 ? buildingPolygon : null,
  };
}

function publicId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

function safeId(value, prefix) {
  const id = clean(value, 80);
  return new RegExp(`^${prefix}_[A-Za-z0-9_-]{8,64}$`).test(id) ? id : null;
}

function optionalIso(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeStop(stop, index) {
  if (!stop || !["event", "restaurant"].includes(stop.type)) throw new Error(`stop ${index + 1} has an invalid type`);
  const latitude = finite(stop.latitude);
  const longitude = finite(stop.longitude);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error(`stop ${index + 1} has invalid coordinates`);
  }
  const title = clean(stop.title, 120);
  if (!title) throw new Error(`stop ${index + 1} requires a title`);
  return {
    id: clean(stop.id, 120) || `${stop.type}-${index + 1}`,
    type: stop.type,
    title,
    place: clean(stop.place, 160) || title,
    detail: clean(stop.detail, 300) || null,
    latitude,
    longitude,
    verification: normalizeVerification(stop),
    cuisine: clean(stop.cuisine, 160) || null,
    openingHours: clean(stop.openingHours, 500) || null,
    accessibility: clean(stop.accessibility || stop.wheelchair, 160) || null,
    availability: ["available", "unavailable", "unknown"].includes(stop.availability) ? stop.availability : "unknown",
    startsAt: optionalIso(stop.startsAt),
    endsAt: optionalIso(stop.endsAt || stop.expiresAt),
    sourceUrl: /^https?:\/\//.test(String(stop.sourceUrl || "")) ? String(stop.sourceUrl).slice(0, 1000) : null,
  };
}

function normalizePlan(input) {
  if (!input || !Array.isArray(input.stops)) throw new Error("stops must be an array");
  if (input.stops.length < 1 || input.stops.length > MAX_STOPS) throw new Error(`a plan must contain 1 to ${MAX_STOPS} stops`);
  return {
    schemaVersion: SCHEMA_VERSION,
    title: clean(input.title, 100) || "My Singapore day out",
    travelMode: ["walking", "driving", "bicycling", "transit"].includes(input.travelMode) ? input.travelMode : "walking",
    stops: input.stops.map(normalizeStop),
  };
}

function futureIso(now, durationMs) { return new Date(now.getTime() + durationMs).toISOString(); }
function isPast(value, now) { return value ? Date.parse(value) <= now.getTime() : false; }

function missionCopy(stop, theme) {
  const subject = stop.type === "restaurant"
    ? `a dish, menu detail, or storefront feature that captures${stop.cuisine ? ` its ${stop.cuisine} character` : " the flavour of this stop"}`
    : `an architectural detail, event sign, or scene that captures${stop.detail ? ` “${stop.detail}”` : " the atmosphere"} without disrupting the event`;
  const lead = theme === "detective" ? "Case file" : theme === "foodie" ? "Taste trail" : "Explore";
  return `${lead}: go to ${stop.place}. Share your live location, then photograph ${subject}.`;
}

function googleMapsStopUrl(mission) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${mission.latitude},${mission.longitude}`);
  return url.href;
}

class PlanGameService {
  constructor({
    root = process.env.PLAN_STORE_ROOT || path.join(process.cwd(), "outputs", "plans"),
    botUsername = process.env.TELEGRAM_BOT_USERNAME || "",
    repository,
    clock = () => new Date(),
    planTtlMs = DEFAULT_PLAN_TTL_MS,
    gameTtlMs = DEFAULT_GAME_TTL_MS,
    photoVerifier = new MetadataPhotoVerifier(),
    photoRetentionMs = Number(process.env.PHOTO_RETENTION_MS || DEFAULT_PHOTO_RETENTION_MS),
    adaptiveLocationEnabled = process.env.ADAPTIVE_LOCATION_VERIFICATION_ENABLED !== "false",
    photoVerificationEnabled = process.env.PHOTO_VERIFICATION_ENABLED !== "false",
    logger,
  } = {}) {
    this.root = root;
    this.botUsername = clean(botUsername, 64).replace(/^@/, "");
    this.clock = clock;
    this.planTtlMs = planTtlMs;
    this.gameTtlMs = gameTtlMs;
    this.photoVerifier = photoVerifier;
    this.photoRetentionMs = Number.isFinite(photoRetentionMs) ? Math.max(0, photoRetentionMs) : DEFAULT_PHOTO_RETENTION_MS;
    this.adaptiveLocationEnabled = adaptiveLocationEnabled;
    this.photoVerificationEnabled = photoVerificationEnabled;
    this.logger = logger || (process.env.STRUCTURED_LOGS_ENABLED === "true"
      ? (entry) => console.log(JSON.stringify({ timestamp: this.clock().toISOString(), service: "plan-game", ...entry }))
      : () => {});
    this.repository = repository || new SqliteGameRepository({ root, clock });
    this.ownsRepository = !repository;
  }

  photoRetentionDescription() {
    if (this.photoRetentionMs <= 0) return "until the next privacy purge";
    const days = this.photoRetentionMs / (24 * 60 * 60 * 1000);
    if (days >= 1) return `${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}`;
    const hours = Math.max(1, Math.ceil(this.photoRetentionMs / (60 * 60 * 1000)));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  telegramDelivery(updateId) { return Number.isFinite(updateId) ? this.repository.getTelegramDelivery(updateId) : null; }
  saveTelegramDelivery(updateId, actions, delivered) {
    if (!Number.isFinite(updateId)) return;
    return this.repository.saveTelegramDelivery(updateId, actions, delivered);
  }
  recordTelegramUpdate(update, status, error) { return this.repository.recordTelegramUpdate(update, status, error); }
  claimTelegramUpdate(update) { return this.repository.claimTelegramUpdate(update); }
  enqueueTelegramActions(updateId, actions) { return this.repository.transaction(() => this.repository.enqueueOutbound(updateId, actions)); }
  claimTelegramActions(updateId, workerId) { return this.repository.claimOutboundForUpdate(updateId, workerId); }
  markTelegramActionDelivered(id) { return this.repository.markOutboundDelivered(id); }
  markTelegramActionFailed(id, error) { return this.repository.markOutboundFailed(id, error); }
  telegramOutbox(updateId) { return this.repository.outboundForUpdate(updateId); }
  consumeTelegramRateLimit(chatId, limit = 30, windowMs = 60_000) { return this.repository.consumeRateLimit(`telegram:${chatId}`, limit, windowMs); }
  claimDueTelegramActions(workerId, limit) { return this.repository.claimDueOutbound(workerId, limit); }

  createPlan(input) {
    const now = this.clock();
    const plan = { id: publicId("plan"), ...normalizePlan(input), createdAt: now.toISOString(), lastActivityAt: now.toISOString(), expiresAt: futureIso(now, this.planTtlMs), revokedAt: null };
    return this.repository.transaction(() => this.repository.createPlan(plan));
  }

  getPlan(id) {
    const valid = safeId(id, "plan");
    return valid ? this.repository.getPlan(valid) : null;
  }

  planAvailability(id) {
    const plan = this.getPlan(id);
    if (!plan) return "missing";
    if (plan.revokedAt) return "revoked";
    if (isPast(plan.expiresAt, this.clock())) return "expired";
    return "available";
  }

  revokePlan(id) {
    const plan = this.getPlan(id);
    if (!plan) throw new Error("plan was not found");
    if (!plan.revokedAt) {
      plan.revokedAt = this.clock().toISOString();
      this.repository.transaction(() => this.repository.savePlan(plan));
    }
    return plan;
  }

  createGame({ planId, theme = "explorer", timerMinutes = null }) {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error("plan was not found");
    const now = this.clock();
    if (plan.revokedAt) throw new Error("plan was revoked");
    if (isPast(plan.expiresAt, now)) throw new Error("plan expired");
    const selectedTheme = THEMES.has(theme) ? theme : "explorer";
    const timeLimitMinutes = finite(timerMinutes) === null ? null : bounded(timerMinutes, null, 15, 720);
    const game = {
      id: publicId("game"), schemaVersion: SCHEMA_VERSION, planId: plan.id,
      snapshotVersion: 1, title: `${plan.title} Challenge`, travelMode: plan.travelMode, theme: selectedTheme,
      options: { timeLimitMinutes },
      createdAt: now.toISOString(), expiresAt: futureIso(now, this.gameTtlMs), revokedAt: null,
      missions: plan.stops.map((stop, index) => ({
        id: `mission-${index + 1}`, sourceId: stop.id, type: stop.type, order: index + 1, title: stop.title, place: stop.place,
        latitude: stop.latitude, longitude: stop.longitude, radiusMeters: stop.verification.radiusMeters,
        verification: structuredClone(stop.verification),
        detail: stop.detail, sourceUrl: stop.sourceUrl, cuisine: stop.cuisine, openingHours: stop.openingHours,
        accessibility: stop.accessibility, availability: stop.availability, startsAt: stop.startsAt, endsAt: stop.endsAt,
        mapsUrl: googleMapsStopUrl(stop),
        prompt: missionCopy(stop, selectedTheme),
      })),
    };
    this.repository.transaction(() => {
      this.repository.createGame(game);
      plan.lastActivityAt = now.toISOString();
      plan.expiresAt = futureIso(now, this.planTtlMs);
      this.repository.savePlan(plan);
    });
    return { ...game, telegramUrl: this.botUsername ? `https://t.me/${this.botUsername}?start=${game.id}` : null };
  }

  getGame(id) {
    const valid = safeId(id, "game");
    return valid ? this.repository.getGame(valid) : null;
  }

  readSession(gameId, chatId) {
    const defaults = {
      gameId, chatId: String(chatId), missionIndex: 0, phase: "location", status: "active", completed: false,
      score: 0, streak: 0, skipped: 0, history: [], locationReadings: [], seenUpdateIds: [], startedAt: this.clock().toISOString(),
    };
    const session = this.repository.getSession(gameId, chatId, defaults);
    return { ...defaults, ...session, history: session.history || [], locationReadings: session.locationReadings || [], seenUpdateIds: session.seenUpdateIds || [] };
  }

  saveSession(session) {
    session.seenUpdateIds = session.seenUpdateIds.slice(-100);
    session.updatedAt = this.clock().toISOString();
    return this.repository.saveSession(session);
  }

  missionMessage(game, session) {
    const mission = game.missions[session.missionIndex];
    return `Mission ${mission.order}/${game.missions.length}: ${mission.title}\n${mission.prompt}\nProgress: ${session.missionIndex}/${game.missions.length} complete\nOpen next stop in Google Maps: ${mission.mapsUrl || googleMapsStopUrl(mission)}`;
  }

  gameAvailability(game) {
    if (!game) return "missing";
    if (game.revokedAt) return "revoked";
    if (isPast(game.expiresAt, this.clock())) return "expired";
    return "available";
  }

  revokeGame(id) {
    const game = this.getGame(id);
    if (!game) throw new Error("game was not found");
    this.repository.transaction(() => {
      if (!game.revokedAt) {
        game.revokedAt = this.clock().toISOString();
        this.repository.saveGame(game);
      }
      // Always repeat cleanup so an interrupted older deployment cannot leave
      // verification state attached to an already-revoked game.
      this.repository.terminateGameSessions(game.id, "revoked");
    });
    return game;
  }

  completionMessage(game, session) {
    const minutes = Math.max(1, Math.round((this.clock().getTime() - Date.parse(session.startedAt)) / 60_000));
    const route = game.missions.map((mission, index) => `${index + 1}. ${mission.title}`).join("\n");
    return `Challenge complete! You finished all ${game.missions.length} missions in ${game.title}. 🎉\nScore: ${session.score} · Skipped: ${session.skipped} · ${minutes} min\n\nYour route recap:\n${route}\n\nUse /recap any time to replay this summary.`;
  }

  advanceVerifiedMission(game, session, mission, history) {
    session.missionIndex += 1;
    session.score += 100 + Math.min(session.streak * 10, 50);
    session.streak += 1;
    session.history.push(history);
    session.phase = "location";
    if (session.missionIndex >= game.missions.length) {
      if (session.deadlineAt) {
        const bonus = Math.min(100, Math.max(0, Math.ceil((Date.parse(session.deadlineAt) - this.clock().getTime()) / 60_000)));
        session.score += bonus;
        session.history.push({ type: "timer_bonus", points: bonus, at: this.clock().toISOString() });
      }
      session.completed = true;
      session.status = "completed";
      this.repository.terminateSession(session);
      return { chatId: session.chatId, text: this.completionMessage(game, session), removeKeyboard: true };
    }
    this.saveSession(session);
    return { chatId: session.chatId, text: `Photo accepted!\n\n${this.missionMessage(game, session)}`, requestLocation: true };
  }

  reviewPhotoSubmission(id, { status, reviewer, reason } = {}) {
    if (!["accepted", "rejected"].includes(status)) throw new Error("review status must be accepted or rejected");
    return this.repository.transaction(() => {
      const existing = this.repository.getPhotoSubmission(id);
      if (!existing) throw new Error("photo submission was not found");
      if (existing.status !== "needs_review") throw new Error("photo submission is not awaiting review");
      const game = this.getGame(existing.game_id);
      const session = this.readSession(existing.game_id, existing.chat_id);
      if (!game || ["completed", "timed_out", "quit", "revoked"].includes(session.status)) throw new Error("photo review task is terminal or deleted");
      const reviewed = this.repository.reviewPhotoSubmission(id, status, reviewer, reason);
      const mission = game?.missions[session.missionIndex];
      session.reviewPendingSubmissionId = null;
      session.status = "active";
      if (status === "rejected") {
        this.saveSession(session);
        return { submission: reviewed, action: { chatId: existing.chat_id, text: "An organizer reviewed that photo and could not accept it. Send a clearer new photo or use /skip." } };
      }
      if (!mission || mission.id !== existing.mission_id || session.completed) return { submission: reviewed, action: null };
      const action = this.advanceVerifiedMission(game, session, mission, {
        type: "photo_accepted", missionId: mission.id, submissionId: existing.id, verifier: "manual-review", at: this.clock().toISOString(),
      });
      action.text = `Organizer review complete: your photo was accepted.\n\n${action.text}`;
      return { submission: reviewed, action };
    });
  }

  listPhotoReviews(query) { return this.repository.listPhotoReviews(query); }
  deletedPhotoReview(id) { return this.repository.deletedPhotoReview(id); }

  handleTelegramUpdate(update) {
    return this.repository.transaction(() => this.handleTelegramUpdateTransaction(update));
  }

  handleTelegramUpdateTransaction(update) {
    const message = update?.message;
    const chatId = message?.chat?.id;
    if (chatId === undefined || chatId === null) return [];
    const text = clean(message.text, 200);
    const command = text.match(/^\/(start|help|status|pause|resume|skip|quit|route|recap)(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);
    if (command?.[1].toLowerCase() === "help" || (command?.[1].toLowerCase() === "start" && !command[2])) {
      return [{ chatId, text: `Open a challenge link to begin. Commands: /status, /route, /pause, /resume, /skip, /quit, /recap, and /help. Photos are used only to verify missions; their identifiers and verification result are retained for ${this.photoRetentionDescription()}, not the image itself.` }];
    }
    const start = command?.[1].toLowerCase() === "start" ? clean(command[2], 100).match(/^(game_[A-Za-z0-9_-]+)$/) : null;
    if (start) {
      const game = this.getGame(start[1]);
      if (!game) return [{ chatId, text: "That challenge link is invalid or no longer available." }];
      const availability = this.gameAvailability(game);
      if (availability !== "available") return [{ chatId, text: `That challenge has ${availability}. Ask the organizer for a new link.` }];
      const existing = this.readSession(game.id, chatId);
      const session = existing.updatedAt ? { ...existing } : existing;
      if (!existing.updatedAt && game.options?.timeLimitMinutes) session.deadlineAt = futureIso(this.clock(), game.options.timeLimitMinutes * 60_000);
      session.seenUpdateIds = [...new Set([...(session.seenUpdateIds || []), ...[update.update_id].filter(Number.isFinite)])];
      this.saveSession(session);
      if (["completed", "timed_out", "quit", "revoked"].includes(session.status)) return [{ chatId, text: session.status === "completed"
        ? `Welcome back. ${this.completionMessage(game, session)}`
        : `This challenge session is ${session.status.replaceAll("_", " ")} and cannot be resumed.` }];
      this.repository.setActiveSession(chatId, game.id);
      return [{ chatId, text: `Welcome to ${game.title}!\nPhotos are used only to verify missions. The bot stores the photo identifier and verification result for ${this.photoRetentionDescription()}, not the image itself.\n\n${this.missionMessage(game, session)}`, requestLocation: session.phase === "location" }];
    }

    const activeGameId = this.repository.getActiveGameId(chatId);
    const active = safeId(activeGameId, "game") ? this.readSession(activeGameId, chatId) : null;
    if (!active) return [{ chatId, text: "Open a challenge link first, then press Start." }];
    if (Number.isFinite(update.update_id) && active.seenUpdateIds.includes(update.update_id)) return [];
    if (Number.isFinite(update.update_id)) active.seenUpdateIds.push(update.update_id);
    const game = this.getGame(active.gameId);
    const availability = this.gameAvailability(game);
    if (availability !== "available") return [{ chatId, text: `This challenge is ${availability}. Your progress is saved, but it can no longer continue.` }];
    if (command?.[1].toLowerCase() === "recap" && active.completed) {
      this.saveSession(active);
      return [{ chatId, text: this.completionMessage(game, active), removeKeyboard: true }];
    }
    if (active.completed || active.status === "completed") return [{ chatId, text: "You already completed this challenge. Use /recap for your results or open another challenge link to play again." }];
    if (active.deadlineAt && isPast(active.deadlineAt, this.clock())) {
      active.status = "timed_out";
      active.completed = true;
      active.history.push({ type: "timed_out", missionIndex: active.missionIndex, at: this.clock().toISOString() });
      this.repository.terminateSession(active);
      return [{ chatId, text: `Time is up. You completed ${active.missionIndex}/${game.missions.length} missions with ${active.score} points. Use /recap to review the route.`, removeKeyboard: true }];
    }
    const mission = game?.missions[active.missionIndex];
    if (!mission) return [{ chatId, text: "This challenge is unavailable." }];

    if (command?.[1].toLowerCase() === "quit") {
      active.status = "quit";
      active.completed = true;
      active.history.push({ type: "quit", at: this.clock().toISOString(), missionIndex: active.missionIndex });
      this.repository.terminateSession(active);
      return [{ chatId, text: `You left ${game.title}. Your progress remains saved; open its original link to return.`, removeKeyboard: true }];
    }
    if (command?.[1].toLowerCase() === "pause") {
      active.status = "paused";
      this.saveSession(active);
      return [{ chatId, text: "Challenge paused. Use /resume when you are ready to continue.", removeKeyboard: true }];
    }
    if (command?.[1].toLowerCase() === "resume") {
      active.status = "active";
      this.saveSession(active);
      return [{ chatId, text: `Challenge resumed.\n\n${this.missionMessage(game, active)}`, requestLocation: active.phase === "location" }];
    }
    if (command?.[1].toLowerCase() === "status") {
      this.saveSession(active);
      const remaining = active.deadlineAt ? ` · ${Math.max(0, Math.ceil((Date.parse(active.deadlineAt) - this.clock().getTime()) / 60_000))} min left` : "";
      return [{ chatId, text: `${this.missionMessage(game, active)}\nCurrent step: ${active.phase === "location" ? "share location" : "send a photo"}.\nScore: ${active.score} · Skipped: ${active.skipped}${remaining}${active.status === "paused" ? " · Paused" : ""}`, requestLocation: active.phase === "location" && active.status !== "paused" }];
    }
    const isPhotoRetry = active.status === "paused" && active.reviewPendingSubmissionId && Array.isArray(message.photo) && message.photo.length;
    if (active.status === "paused" && !isPhotoRetry) return [{ chatId, text: "This challenge is paused. Use /resume to continue or /quit to leave." }];
    if (command?.[1].toLowerCase() === "route") {
      this.saveSession(active);
      return [{ chatId, text: `Next stop: ${mission.title}\n${mission.mapsUrl || googleMapsStopUrl(mission)}` }];
    }
    if (command?.[1].toLowerCase() === "skip") {
      active.skipped += 1;
      active.score = Math.max(0, active.score - 25);
      active.streak = 0;
      active.history.push({ type: "skipped", missionId: mission.id, at: this.clock().toISOString() });
      active.missionIndex += 1;
      active.phase = "location";
      if (active.missionIndex >= game.missions.length) {
        active.completed = true;
        active.status = "completed";
        this.repository.terminateSession(active);
        return [{ chatId, text: this.completionMessage(game, active), removeKeyboard: true }];
      }
      this.saveSession(active);
      return [{ chatId, text: `Mission skipped (-25 points).\n\n${this.missionMessage(game, active)}`, requestLocation: true }];
    }
    if (message.location) {
      const evidence = this.adaptiveLocationEnabled ? verifyLocationEvidence({
        mission, location: message.location, messageDate: message.date, now: this.clock(), priorReadings: active.locationReadings,
      }) : (() => {
        const distance = Math.round(distanceMeters(message.location, mission));
        return distance <= mission.radiusMeters
          ? { status: "accepted", reason: "legacy_radius", distanceMeters: distance, effectiveRadiusMeters: mission.radiusMeters, accuracyMeters: null }
          : { status: "rejected", reason: "too_far", distanceMeters: distance, effectiveRadiusMeters: mission.radiusMeters, accuracyMeters: null };
      })();
      if (evidence.reading) active.locationReadings.push(evidence.reading);
      active.locationReadings = active.locationReadings.slice(-20);
      if (evidence.status === "pending") {
        this.saveSession(active);
        return [{ chatId, text: "I need one more consistent location reading. Wait a moment, then share your location again.", requestLocation: true }];
      }
      if (evidence.status !== "accepted") {
        this.saveSession(active);
        const messages = {
          stale_location: "That location reading is too old. Share a fresh location from Telegram.",
          future_location: "That location timestamp is invalid. Share your current location again.",
          low_accuracy: `Location accuracy is too low (${Math.round(evidence.accuracyMeters)} m). Move into an open area and try again.`,
          invalid_coordinates: "That location could not be read. Please share it again.",
        };
        const fallback = `You are about ${evidence.distanceMeters} m away. Get within ${evidence.effectiveRadiusMeters || mission.radiusMeters} m of ${mission.place} and share your location again.`;
        return [{ chatId, text: messages[evidence.reason] || fallback, requestLocation: true }];
      }
      active.phase = "photo";
      active.history.push({ type: "location_verified", missionId: mission.id, distanceMeters: evidence.distanceMeters, method: evidence.reason, accuracyMeters: evidence.accuracyMeters, at: this.clock().toISOString() });
      this.saveSession(active);
      return [{ chatId, text: `Location confirmed: ${evidence.distanceMeters} m from the stop. Now send your challenge photo.`, removeKeyboard: true }];
    }
    if (Array.isArray(message.photo) && message.photo.length) {
      if (active.phase !== "photo") {
        this.saveSession(active);
        return [{ chatId, text: "Share your location first so I can confirm you reached the stop.", requestLocation: true }];
      }
      const verification = this.photoVerifier.verify({ message, precomputed: this.photoVerificationEnabled ? update.photoVerification : null, game, mission, session: active });
      if (isPhotoRetry) active.status = "active";
      if (!verification || typeof verification.then === "function") throw new Error("photo verifier must return a synchronous result");
      const deleteAfter = this.photoRetentionMs > 0 ? futureIso(this.clock(), this.photoRetentionMs) : this.clock().toISOString();
      const saved = verification.fileUniqueId ? this.repository.savePhotoSubmission({
        gameId: game.id, chatId, missionId: mission.id, fileUniqueId: verification.fileUniqueId,
        status: verification.status, verifier: verification.verifier, result: verification, deleteAfter,
      }) : null;
      if (saved?.duplicate) {
        this.saveSession(active);
        return [{ chatId, text: "That photo was already used in this challenge. Take a new photo for this mission." }];
      }
      if (verification.status !== "accepted") {
        active.history.push({ type: "photo_unverified", missionId: mission.id, submissionId: saved?.id || null, status: verification.status, reason: verification.reason, at: this.clock().toISOString() });
        if (verification.status === "needs_review") {
          active.status = "paused";
          active.reviewPendingSubmissionId = saved?.id || null;
        }
        this.saveSession(active);
        return [{ chatId, text: verification.status === "needs_review"
          ? "I could not verify that photo automatically. It has been marked for review; you can send a clearer new photo or use /skip."
          : "That photo does not meet this mission’s requirement. Take a new photo that clearly shows the requested subject." }];
      }
      return [this.advanceVerifiedMission(game, active, mission, {
        type: "photo_accepted", missionId: mission.id, submissionId: saved?.id || null, verifier: verification.verifier, at: this.clock().toISOString(),
      })];
    }
    this.saveSession(active);
    return [{ chatId, text: active.phase === "location" ? "Please share your location using the button below." : "Send a photo to complete this mission.", requestLocation: active.phase === "location" }];
  }

  diagnostics() { return { storage: "sqlite", pendingMessages: this.repository.counts().pendingMessages }; }
  purgeExpiredPhotoSubmissions() { return this.repository.purgeExpiredPhotoSubmissions(); }
  purgeExpiredPlans() { return this.repository.purgeExpiredPlans(); }
  purgeAbandonedSessions() { return this.repository.purgeAbandonedSessions(); }
  purgeSettledTelegramRecords() { return this.repository.purgeSettledTelegramRecords(); }
  close() { if (this.ownsRepository) this.repository.close(); }
}

module.exports = { PlanGameService, distanceMeters, normalizePlan };
