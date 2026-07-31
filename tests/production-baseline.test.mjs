import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { applySecurityHeaders } = require("../scripts/lib/http-contract.cjs");

function captureSecurityHeaders() {
  const headers = new Map();
  applySecurityHeaders({
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
  });
  return headers;
}

test("production baseline grants microphone only to self", () => {
  const headers = captureSecurityHeaders();
  assert.equal(
    headers.get("permissions-policy"),
    "camera=(), microphone=(self), geolocation=(self)",
  );
  assert.equal(headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
});

test("production baseline keeps provider connections and credentials out of the browser policy", () => {
  const csp = captureSecurityHeaders().get("content-security-policy");
  assert.match(csp, /(?:^|;)\s*connect-src\s[^;]*'self'/);
  assert.doesNotMatch(csp, /api\.openai\.com|wss:\/\/[^;]*openai/i);
  assert.doesNotMatch(csp, /OPENAI_API_KEY|Bearer\s/i);
});
