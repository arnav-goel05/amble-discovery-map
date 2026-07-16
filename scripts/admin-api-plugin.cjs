"use strict";

const path = require("node:path");
const { AdminRepository } = require("./lib/admin-repository.cjs");
const { AdminAuthService } = require("./lib/admin-auth-service.cjs");
const { AdminService } = require("./lib/admin-service.cjs");
const { PlanGameService } = require("./lib/plan-game-service.cjs");
const { errorEnvelope, readJsonBody, sendJson, successEnvelope } = require("./lib/http-contract.cjs");

const COOKIE = "wh_admin";
const cookies = (request) => Object.fromEntries(String(request.headers.cookie ?? "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
const sessionCookie = (token, maxAge, { secure = true } = {}) => `${COOKIE}=${encodeURIComponent(token)}; Path=/api/admin; Max-Age=${maxAge}${secure ? "; Secure" : ""}; HttpOnly; SameSite=Strict`;
const clearCookie = ({ secure = true } = {}) => `${COOKIE}=; Path=/api/admin; Max-Age=0${secure ? "; Secure" : ""}; HttpOnly; SameSite=Strict`;
const source = { id: "private-admin", costClass: "free" };

function adminApiPlugin(options = {}) {
  const repository = options.repository || new AdminRepository({ databasePath: options.databasePath || process.env.ADMIN_DATABASE_PATH || path.join(process.cwd(), "outputs/admin/admin.sqlite"), clock: options.clock });
  const auth = options.auth || new AdminAuthService({ repository, passwordHash: options.passwordHash ?? process.env.ADMIN_PASSWORD_HASH ?? "", clock: options.clock, sessionTtlMs: options.sessionTtlMs, maxAttempts: options.maxAttempts });
  const service = options.service || new AdminService({ repository });
  const gameService = options.gameService || new PlanGameService(options.gameOptions);
  const ownsGameService = !options.gameService;
  const secureCookies = options.secureCookies ?? process.env.ADMIN_SECURE_COOKIES !== "0";

  const respond = (response, data, status = 200) => sendJson(response, status, successEnvelope(data, { source }));
  const fail = (response, error) => {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const code = /^[a-z0-9_]+$/.test(error?.code ?? "") ? error.code : "internal_error";
    const message = status >= 500 ? "The request could not be completed." : error.message;
    sendJson(response, status, errorEnvelope(code, message));
  };
  const authenticate = (request, mutation = false) => auth.authenticate(cookies(request)[COOKIE], { csrfToken: request.headers["x-csrf-token"], mutation });

  const middleware = async (request, response, next) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { return next(); }
    if (!url.pathname.startsWith("/api/admin/")) return next();
    try {
      if (url.pathname === "/api/admin/session") {
        if (request.method === "POST") {
          const body = await readJsonBody(request, { maxBytes: 4096 });
          const result = auth.login(body.password, request.socket?.remoteAddress ?? "unknown");
          response.setHeader("Set-Cookie", sessionCookie(result.sessionToken, Math.max(1, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000)), { secure: secureCookies }));
          return respond(response, { authenticated: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
        }
        if (request.method === "GET") return respond(response, auth.refresh(cookies(request)[COOKIE]));
        if (request.method === "DELETE") {
          auth.logout(cookies(request)[COOKIE], request.headers["x-csrf-token"]);
          response.setHeader("Set-Cookie", clearCookie({ secure: secureCookies }));
          return respond(response, { authenticated: false });
        }
        response.setHeader("Allow", "GET, POST, DELETE");
        return sendJson(response, 405, errorEnvelope("method_not_allowed", "Method is not supported"));
      }

      authenticate(request, request.method !== "GET");
      if (request.method === "GET" && url.pathname === "/api/admin/venue-reviews") {
        return respond(response, service.listVenueReviews({ status: url.searchParams.get("status") ?? "pending", cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") }));
      }
      if (request.method === "GET" && url.pathname === "/api/admin/photo-reviews") {
        return respond(response, gameService.listPhotoReviews({ status: url.searchParams.get("status") ?? "needs_review", cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") }));
      }
      const photoDecision = url.pathname.match(/^\/api\/admin\/photo-reviews\/(\d+)$/);
      if (request.method === "POST" && photoDecision) {
        const body = await readJsonBody(request, { maxBytes: 8_192 });
        const idempotencyKey = body.idempotencyKey ?? request.headers["idempotency-key"];
        if (!idempotencyKey || String(idempotencyKey).length > 200) {
          const error = new Error("An idempotency key is required"); error.code = "idempotency_key_required"; error.status = 400; throw error;
        }
        if (!["accepted", "rejected"].includes(body.decision) || !String(body.reason ?? "").trim()) {
          const error = new Error("Photo decision and reason are required"); error.code = "photo_review_decision_invalid"; error.status = 400; throw error;
        }
        const submissionId = Number(photoDecision[1]);
        if (gameService.deletedPhotoReview(submissionId)) {
          const error = new Error("Photo review task is terminal or deleted"); error.code = "photo_review_terminal"; error.status = 409; throw error;
        }
        try {
          const result = repository.performIdempotent(String(idempotencyKey), `photo-review:${submissionId}`, () => {
            const reviewed = gameService.reviewPhotoSubmission(submissionId, { status: body.decision, reviewer: "admin", reason: String(body.reason).slice(0, 1000) });
            if (reviewed.action) {
              const deliveryId = -submissionId;
              gameService.saveTelegramDelivery(deliveryId, [reviewed.action], false);
              gameService.enqueueTelegramActions(deliveryId, [reviewed.action]);
            }
            return { submission: { id: reviewed.submission.id, status: reviewed.submission.status }, notificationQueued: Boolean(reviewed.action), idempotent: false };
          });
          return respond(response, result);
        } catch (error) {
          if (/terminal|deleted|not found|not awaiting review/i.test(error.message)) { error.code = "photo_review_terminal"; error.status = 409; }
          throw error;
        }
      }
      const planRevoke = url.pathname.match(/^\/api\/admin\/plans\/(plan_[A-Za-z0-9_-]+)\/revoke$/);
      if (request.method === "POST" && planRevoke) return respond(response, gameService.revokePlan(planRevoke[1]));
      const gameRevoke = url.pathname.match(/^\/api\/admin\/games\/(game_[A-Za-z0-9_-]+)\/revoke$/);
      if (request.method === "POST" && gameRevoke) return respond(response, gameService.revokeGame(gameRevoke[1]));
      const detail = url.pathname.match(/^\/api\/admin\/venue-reviews\/(vr_[A-Za-z0-9_-]+)$/);
      if (request.method === "GET" && detail) {
        const review = service.venueReview(detail[1]);
        if (!review) return sendJson(response, 404, errorEnvelope("venue_review_not_found", "Venue review was not found"));
        return respond(response, review);
      }
      const decision = url.pathname.match(/^\/api\/admin\/venue-reviews\/(vr_[A-Za-z0-9_-]+)\/decision$/);
      if (request.method === "POST" && decision) {
        const body = await readJsonBody(request, { maxBytes: 16_384 });
        body.idempotencyKey ??= request.headers["idempotency-key"];
        if (!body.idempotencyKey || String(body.idempotencyKey).length > 200) {
          const error = new Error("An idempotency key is required"); error.code = "idempotency_key_required"; error.status = 400; throw error;
        }
        return respond(response, service.decideVenueReview(decision[1], body));
      }
      return sendJson(response, 404, errorEnvelope("route_not_found", "Admin route was not found"));
    } catch (error) { return fail(response, error); }
  };

  return {
    name: "private-admin-api", repository, auth, service, gameService, middleware,
    close() { repository.close(); if (ownsGameService) gameService.close(); },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

module.exports = { adminApiPlugin, clearCookie, sessionCookie };
