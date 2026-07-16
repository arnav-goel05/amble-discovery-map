"use strict";

const crypto = require("node:crypto");

class AdminAuthError extends Error {
  constructor(code, message, status = 401) { super(message); this.code = code; this.status = status; }
}

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("base64url");
  return `scrypt$v1$${salt}$${derived}`;
}

function verifyAdminPassword(password, encoded) {
  const [algorithm, version, salt, expected] = String(encoded ?? "").split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expected) return false;
  let actual;
  try { actual = crypto.scryptSync(String(password), salt, 64).toString("base64url"); }
  catch { return false; }
  return safeEqual(actual, expected);
}

class AdminAuthService {
  constructor({ repository, passwordHash, clock = () => new Date(), sessionTtlMs = 8 * 60 * 60 * 1000, throttleWindowMs = 15 * 60 * 1000, maxAttempts = 5 } = {}) {
    if (!repository) throw new Error("AdminAuthService requires a repository");
    this.repository = repository;
    this.passwordHash = passwordHash ?? "";
    this.clock = clock;
    this.sessionTtlMs = sessionTtlMs;
    this.throttleWindowMs = throttleWindowMs;
    this.maxAttempts = maxAttempts;
  }

  login(password, subject = "unknown") {
    const subjectHash = digest(subject);
    const since = new Date(this.clock().valueOf() - this.throttleWindowMs).toISOString();
    if (this.repository.loginAttemptsSince(subjectHash, since) >= this.maxAttempts) {
      throw new AdminAuthError("admin_login_throttled", "Unable to sign in", 429);
    }
    if (!verifyAdminPassword(password, this.passwordHash)) {
      this.repository.recordLoginAttempt(subjectHash);
      throw new AdminAuthError("admin_login_failed", "Unable to sign in", 401);
    }
    this.repository.clearLoginAttempts(subjectHash);
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const csrfToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.clock().valueOf() + this.sessionTtlMs).toISOString();
    this.repository.createSession({ tokenHash: digest(sessionToken), csrfHash: digest(csrfToken), expiresAt });
    return { authenticated: true, sessionToken, csrfToken, expiresAt };
  }

  authenticate(sessionToken, { csrfToken = null, mutation = false } = {}) {
    if (!sessionToken) throw new AdminAuthError("admin_auth_required", "Administrator authentication is required", 401);
    const session = this.repository.session(digest(sessionToken));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= this.clock().valueOf()) {
      throw new AdminAuthError("admin_session_invalid", "Administrator session is invalid or expired", 401);
    }
    if (mutation && (!csrfToken || !safeEqual(digest(csrfToken), session.csrfHash))) {
      throw new AdminAuthError("admin_csrf_invalid", "The request could not be verified", 403);
    }
    return { authenticated: true, expiresAt: session.expiresAt };
  }

  logout(sessionToken, csrfToken) {
    this.authenticate(sessionToken, { csrfToken, mutation: true });
    this.repository.revokeSession(digest(sessionToken));
    return { authenticated: false };
  }

  refresh(sessionToken) {
    const authenticated = this.authenticate(sessionToken);
    const csrfToken = crypto.randomBytes(32).toString("base64url");
    this.repository.rotateSessionCsrf(digest(sessionToken), digest(csrfToken));
    return { ...authenticated, csrfToken };
  }
}

module.exports = { AdminAuthError, AdminAuthService, hashAdminPassword, verifyAdminPassword };
